// Game logic tests for freecell.html: `node --test`
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

// Run the page's <script> with a stub DOM so we can drive the real move/select code.
const code = readFileSync(new URL('./freecell.html', import.meta.url), 'utf8').match(/<script>([\s\S]*)<\/script>/)[1];
const el = () => ({
  style: { setProperty() {} }, dataset: {}, textContent: '', innerHTML: '', disabled: false,
  classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
  append() {}, appendChild: c => c, remove() {}, focus() {}, querySelectorAll: () => [],
  querySelector: () => null, addEventListener() {}, closest: () => null,
});
const nodes = new Map();
const ctx = {
  document: {
    getElementById: id => {
      if (!nodes.has(id)) nodes.set(id, el());
      return nodes.get(id);
    },
    createElement: el, activeElement: null,
  },
  addEventListener() {}, requestAnimationFrame: fn => fn(), setTimeout: fn => fn(), clearTimeout() {},
  innerWidth: 900, innerHeight: 900, console,
};
vm.createContext(ctx);
vm.runInContext(code, ctx);

const run = expression => vm.runInContext(expression, ctx);
const c = (r, s) => ({ r, s });
const empty = () => [[], [], [], []];
const cols8 = cols => Array.from({ length: 8 }, (_, i) => cols[i] || []);
const setup = ({ cols = [], free = [null, null, null, null], found = empty() }) => {
  run(`
    cols = ${JSON.stringify(cols8(cols))};
    free = ${JSON.stringify(free)};
    found = ${JSON.stringify(found)};
    sel = null; moves = 0; won = false; undoStack = []; dealing = false;
    draw();
  `);
};
const take = () => JSON.parse(run('JSON.stringify(sel ? selectedRun().map(c => [c.r, c.s]) : null)'));

test('number cards show exactly as many pips as their rank', () => {
  for (let r = 2; r <= 10; r++) {
    const html = run(`faceHTML({ r:${r}, s:0 })`);
    assert.equal((html.match(/class="pip"/g) || []).length, r, `rank ${r}`);
  }
  assert.equal((run('faceHTML({ r:1, s:1 })').match(/class="pip"/g) || []).length, 1);
  assert.equal((run('faceHTML({ r:12, s:2 })').match(/class="corner /g) || []).length, 2);
});

test('deals 52 unique cards into columns of 7,7,7,7,6,6,6,6', () => {
  run('newGame()');
  assert.deepEqual(Array.from(run('cols.map(c => c.length)')), [7, 7, 7, 7, 6, 6, 6, 6]);
  const ids = JSON.parse(run('JSON.stringify(cols.flat().map(c => c.s * 13 + c.r))'));
  assert.equal(new Set(ids).size, 52);
});

test('tableau takes descending cards of alternating colour only', () => {
  setup({ cols: [[c(10, 0)]] });
  run('free[0] = {r:9, s:1}; sel = {kind:"free", i:0}');
  assert.equal(run('place({kind:"col", i:0})'), true);
  assert.deepEqual(Array.from(run('cols[0].map(c => c.r)')), [10, 9]);

  setup({ cols: [[c(10, 0)]] });
  run('free[0] = {r:9, s:0}; sel = {kind:"free", i:0}');
  assert.equal(run('place({kind:"col", i:0})'), false, 'same colour');

  setup({ cols: [[c(10, 0)]] });
  run('free[0] = {r:8, s:1}; sel = {kind:"free", i:0}');
  assert.equal(run('place({kind:"col", i:0})'), false, 'wrong rank');
});

test('a single card fills a free cell; a run cannot', () => {
  setup({ cols: [[c(9, 1), c(8, 0)]] });
  run('selectCard("col", 0, 0)');
  assert.deepEqual(take(), [[9, 1], [8, 0]]);
  assert.equal(run('place({kind:"free", i:0})'), false);

  run('selectCard("col", 0, 1)');
  assert.deepEqual(take(), [[8, 0]]);
  assert.equal(run('place({kind:"free", i:0})'), true);
  assert.equal(run('free[0].r'), 8);
});

test('foundations count up by suit, starting with an ace', () => {
  setup({ free: [c(1, 0), null, null, null] });
  run('sel = {kind:"free", i:0}');
  assert.equal(run('place({kind:"found", i:0})'), true);

  run('free[0] = {r:2, s:0}; sel = {kind:"free", i:0}');
  assert.equal(run('place({kind:"found", i:0})'), true);

  run('free[0] = {r:1, s:1}; sel = {kind:"free", i:0}');
  assert.equal(run('place({kind:"found", i:0})'), false, 'wrong suit');

  run('free[0] = {r:13, s:0}; sel = {kind:"free", i:0}');
  assert.equal(run('place({kind:"found", i:0})'), false, 'must start at the ace');
});

test('supermove capacity follows free cells and empty columns', () => {
  setup({ cols: [[c(13, 0)], [c(13, 1)]] });
  assert.equal(run('maxMove({kind:"col", i:0})'), 5 * 2 ** 6);
  assert.equal(run('maxMove({kind:"col", i:2})'), 5 * 2 ** 5);

  run('free[0] = {r:1, s:0}; free[1] = {r:2, s:0}');
  assert.equal(run('maxMove({kind:"col", i:0})'), 3 * 2 ** 6);
  assert.equal(run('maxMove({kind:"col", i:2})'), 3 * 2 ** 5);
});

test('a run too long for the empty columns is refused, and allowed once a column opens', () => {
  const run9to3 = [c(8, 1), c(7, 0), c(6, 2), c(5, 3), c(4, 1), c(3, 0)];
  setup({
    cols: [run9to3, [c(9, 0)], [c(13, 0)], [c(13, 1)], [c(13, 2)], [c(13, 3)], [c(12, 0)], [c(12, 1)]],
  });
  run('selectCard("col", 0, 0)');
  assert.deepEqual(take(), run9to3.map(x => [x.r, x.s]));
  assert.equal(run('place({kind:"col", i:1})'), false);

  run('cols[2] = []');
  assert.equal(run('place({kind:"col", i:1})'), true);
  assert.equal(run('cols[1].length'), 7);
  assert.deepEqual(Array.from(run('cols[1].map(c => c.r)')), [9, 8, 7, 6, 5, 4, 3]);
  assert.equal(run('cols[0].length'), 0);
});

test('only a clean alternating run can be picked up from a column', () => {
  setup({ cols: [[c(8, 0), c(7, 0)]] });
  run('selectCard("col", 0, 0)');
  assert.equal(run('sel'), null);
  run('selectCard("col", 0, 1)');
  assert.equal(run('sel.j'), 1);
});

test('tapping a card picks it up, and tapping the destination places it', () => {
  setup({ cols: [[c(10, 0)], [c(9, 1)]] });
  run('tapCard({dataset:{kind:"col", i:"1", j:"0"}})');
  assert.deepEqual(take(), [[9, 1]]);

  run('tapCard({dataset:{kind:"col", i:"0", j:"0"}})');
  assert.equal(run('sel'), null);
  assert.deepEqual(Array.from(run('cols[0].map(c => c.r)')), [10, 9]);
});

test('tapping a free cell and a foundation places the held card', () => {
  setup({ cols: [[c(9, 1)]] });
  run('tapCard({dataset:{kind:"col", i:"0", j:"0"}})');
  run('tapSlot({dataset:{slot:"free", i:"2"}})');
  assert.equal(run('free[2].r'), 9);

  setup({ free: [c(1, 0), null, null, null] });
  run('tapCard({dataset:{kind:"free", i:"0"}})');
  run('tapSlot({dataset:{slot:"found", i:"0"}})');
  assert.equal(run('found[0].length'), 1);
  assert.equal(run('free[0]'), null);
});

test('tapping the held card again puts it back down', () => {
  setup({ cols: [[c(9, 1)]] });
  run('tapCard({dataset:{kind:"col", i:"0", j:"0"}})');
  assert.equal(run('sel.j'), 0);
  run('tapCard({dataset:{kind:"col", i:"0", j:"0"}})');
  assert.equal(run('sel'), null);
});

test('undo puts the card back and restores the move count', () => {
  setup({ free: [c(1, 0), null, null, null] });
  run('sel = {kind:"free", i:0}; place({kind:"found", i:0})');
  assert.equal(run('moves'), 1);
  assert.equal(run('found[0].length'), 1);

  run('undo()');
  assert.equal(run('moves'), 0);
  assert.equal(run('found[0].length'), 0);
  assert.equal(run('free[0].r'), 1);
});

test('a card can be taken back off a foundation', () => {
  setup({ found: [[c(1, 0)], [], [], []] });
  run('selectCard("found", 0)');
  assert.equal(run('place({kind:"free", i:0})'), true);
  assert.equal(run('found[0].length'), 0);
  assert.equal(run('free[0].r'), 1);
});

test('sending every king home wins the game', () => {
  const twelve = s => Array.from({ length: 12 }, (_, i) => c(i + 1, s));
  setup({ found: [twelve(0), twelve(1), twelve(2), twelve(3)], free: [c(13, 0), c(13, 1), c(13, 2), c(13, 3)] });

  for (let i = 0; i < 4; i++) {
    assert.equal(run(`sel = {kind:"free", i:${i}}; place({kind:"found", i:${i}})`), true);
  }
  assert.equal(run('won'), true);
  assert.equal(run('moves'), 4);
  assert.equal(run('found.every(p => p.length === 13)'), true);
});
