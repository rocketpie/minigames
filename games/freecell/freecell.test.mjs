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
const store = new Map();
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
  localStorage: {
    getItem: k => store.get(k) ?? null,
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: k => store.delete(k),
  },
};
vm.createContext(ctx);
vm.runInContext(code, ctx);

const run = expression => vm.runInContext(expression, ctx);
const c = (r, s) => ({ r, s });
const empty = () => [[], [], [], []];
const cols8 = cols => Array.from({ length: 8 }, (_, i) => cols[i] || []);
const setup = ({ cols = [], free = [null, null, null, null], found = empty() }) => {
  store.delete('freecell');
  run(`
    cols = ${JSON.stringify(cols8(cols))};
    free = ${JSON.stringify(free)};
    found = ${JSON.stringify(found)};
    sel = null; moves = 0; won = false; undoStack = []; dealing = false; pinned = new Set();
    draw();
  `);
};
const deck = () => {
  const cards = [];
  for (let s = 0; s < 4; s++) for (let r = 1; r <= 13; r++) cards.push(c(r, s));
  return cards;
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

test('a long clean run moves as one group, whatever the free cells and columns', () => {
  const long = [c(9, 1), c(8, 0), c(7, 2), c(6, 3), c(5, 1), c(4, 0), c(3, 2)];
  setup({
    cols: [long, [c(10, 0)], [c(13, 0)], [c(13, 1)], [c(13, 2)], [c(13, 3)], [c(12, 0)], [c(12, 1)]],
    free: [c(12, 2), c(12, 3), c(11, 2), c(11, 3)],
  });
  run('selectCard("col", 0, 0)');
  assert.deepEqual(take(), long.map(x => [x.r, x.s]));
  assert.equal(run('place({kind:"col", i:1})'), true);
  assert.deepEqual(Array.from(run('cols[1].map(c => c.r)')), [10, 9, 8, 7, 6, 5, 4, 3]);
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
  const all = deck();
  const rest = all.filter(x => !(x.r === 1 && x.s === 0));
  const cols = Array.from({ length: 8 }, () => []);
  rest.forEach((x, i) => cols[i % 8].push(x));

  setup({ cols, free: [c(1, 0), null, null, null] });
  run('sel = {kind:"free", i:0}; place({kind:"found", i:0})');
  assert.equal(run('moves'), 1);
  assert.equal(run('found[0].length'), 1);

  run('undo()');
  assert.equal(run('moves'), 0);
  assert.equal(run('found[0].length'), 0);
  assert.equal(run('free[0].r'), 1);
});

test('saves the board and restores it after a visit to the guide', () => {
  const all = deck();
  const keep = new Set([c(10, 0), c(9, 1)].map(x => x.s * 13 + x.r));
  const rest = all.filter(x => !keep.has(x.s * 13 + x.r));
  const cols = [[c(10, 0)], [c(9, 1)], [], [], [], [], [], []];
  rest.forEach((x, i) => cols[2 + (i % 6)].push(x));

  setup({ cols });
  run('tapCard({dataset:{kind:"col", i:"1", j:"0"}})');
  run('tapCard({dataset:{kind:"col", i:"0", j:"0"}})');
  assert.equal(run('moves'), 1);

  const saved = JSON.parse(ctx.localStorage.getItem('freecell'));
  assert.equal(saved.moves, 1);
  assert.deepEqual(saved.cols[0].map(x => x.r), [10, 9]);

  run('cols = [[],[],[],[],[],[],[],[]]; free = [null,null,null,null]; found = [[],[],[],[]]; moves = 0; won = false; undoStack = []; sel = null;');
  assert.equal(run('load()'), true);
  assert.equal(run('moves'), 1);
  assert.deepEqual(Array.from(run('cols[0].map(x => x.r)')), [10, 9]);
});

test('undo history also survives a reload', () => {
  const all = deck();
  const rest = all.filter(x => !(x.r === 1 && x.s === 0));
  const cols = Array.from({ length: 8 }, () => []);
  rest.forEach((x, i) => cols[i % 8].push(x));

  setup({ cols, free: [c(1, 0), null, null, null] });
  run('sel = {kind:"free", i:0}; place({kind:"found", i:0})');
  assert.equal(run('found[0].length'), 1);
  assert.equal(run('undoStack.length'), 1);

  run('cols = [[],[],[],[],[],[],[],[]]; free = [null,null,null,null]; found = [[],[],[],[]]; moves = 0; won = false; undoStack = []; sel = null;');
  assert.equal(run('load()'), true);
  assert.equal(run('undoStack.length'), 1);

  run('undo()');
  assert.equal(run('found[0].length'), 0);
  assert.equal(run('free[0].r'), 1);
  assert.equal(run('moves'), 0);
});

test('a corrupt save is ignored', () => {
  ctx.localStorage.setItem('freecell', '{"cols":[]}');
  assert.equal(run('load()'), false);

  const bad = { cols: Array.from({ length: 8 }, () => []), free: [null, null, null, null], found: empty(), moves: 0, undoStack: [] };
  bad.cols[0] = [c(1, 0)];
  ctx.localStorage.setItem('freecell', JSON.stringify(bad));
  assert.equal(run('load()'), false);
  store.delete('freecell');
});

test('a moved card is drawn at its old spot, then slides to the new one', () => {
  let atReflow = null;
  const props = new Map();
  const card = {
    dataset: { focus: 'c0' },
    get offsetWidth() { atReflow = Object.fromEntries(props); return 0; },
    style: {
      transition: '',
      setProperty: (k, v) => props.set(k, v),
      removeProperty: k => props.delete(k),
    },
    getBoundingClientRect: () => ({ left: 40, top: 70 }),
  };
  const table = ctx.document.getElementById('table');
  table.querySelectorAll = () => [card];
  run('slide(new Map([["c0", { left: 10, top: 10 }]]))');
  table.querySelectorAll = () => [];

  assert.deepEqual(atReflow, { '--mx': '-30px', '--my': '-60px' });
  assert.deepEqual(Object.fromEntries(props), {}, 'offset cleared so the transition runs');
});

test('cards that fit a foundation go home by themselves, chaining upward', () => {
  setup({ free: [c(1, 0), c(2, 0), null, null], cols: [[c(3, 0)]] });
  run('sel = {kind:"free", i:0}; place({kind:"found", i:0})');
  assert.equal(run('found[0].length'), 3);
  assert.equal(run('free[1]'), null);
  assert.equal(run('cols[0].length'), 0);
  assert.equal(run('moves'), 3);
});

test('a card can be taken back off a foundation', () => {
  setup({ found: [[c(1, 0)], [], [], []] });
  run('selectCard("found", 0)');
  assert.equal(run('place({kind:"free", i:0})'), true);
  assert.equal(run('found[0].length'), 0);
  assert.equal(run('free[0].r'), 1);

  run('autoFound()');
  assert.equal(run('found[0].length'), 0, 'autoplay leaves a card you pulled back alone');
});

test('sending every king home wins the game', () => {
  const twelve = s => Array.from({ length: 12 }, (_, i) => c(i + 1, s));
  setup({ found: [twelve(0), twelve(1), twelve(2), twelve(3)], free: [c(13, 0), c(13, 1), c(13, 2), c(13, 3)] });

  run('sel = {kind:"free", i:0}; place({kind:"found", i:0})');
  assert.equal(run('won'), true);
  assert.equal(run('moves'), 4);
  assert.equal(run('found.every(p => p.length === 13)'), true);
});
