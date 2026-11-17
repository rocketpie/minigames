// Game logic tests for nocell.html: `node --test`
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

// Run the page's <script> with a stub DOM so we can drive the real move/select code.
const code = readFileSync(new URL('./nocell.html', import.meta.url), 'utf8').match(/<script>([\s\S]*)<\/script>/)[1];
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
  addEventListener() {}, requestAnimationFrame: fn => fn(), setTimeout: () => 0, clearTimeout() {},
  innerWidth: 900, innerHeight: 900, console, URL,
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
const empty = n => Array.from({ length: n }, () => []);
const cols4 = cols => Array.from({ length: 4 }, (_, i) => cols[i] || []);
const setup = ({ cols = [], free = [null, null], found = empty(2) } = {}) => {
  store.delete('nocell');
  run(`
    cols = ${JSON.stringify(cols4(cols))};
    free = ${JSON.stringify(free)};
    found = ${JSON.stringify(found)};
    sel = null; moves = 0; score = 0; streak = 0; won = false; undoStack = [];
    dealing = false; pinned = new Set();
    draw();
  `);
};
const deck = () => {
  const cards = [];
  for (let s = 0; s < 2; s++) for (let r = 1; r <= 13; r++) cards.push(c(r, s));
  return cards;
};
const take = () => JSON.parse(run('JSON.stringify(sel ? selectedRun().map(c => [c.r, c.s]) : null)'));

test('a new game deals all 26 cards into four non-empty columns and two free cells', () => {
  run('newGame()');
  assert.equal(run('cols.length'), 4);
  assert.ok(run('cols.every(c => c.length)'), 'all four columns are used');
  assert.equal(run('free.length'), 2);
  assert.equal(run('free.every(c => c === null)'), true);
  assert.equal(run('found.length'), 2);

  const cards = JSON.parse(run('JSON.stringify([...cols.flat(), ...free.filter(Boolean), ...found.flat()])'));
  assert.equal(cards.length, 26);
  assert.equal(new Set(cards.map(card => card.s * 13 + card.r)).size, 26);
  assert.ok(cards.every(card => card.s === 0 || card.s === 1));
});

test('generated deals need a move before any card can go home', () => {
  for (let deal = 0; deal < 50; deal++) {
    const { cols } = JSON.parse(run('JSON.stringify(generateDeal())'));
    run(`
      cols = ${JSON.stringify(cols)};
      free = [null, null];
      found = [[], []];
      sel = null; won = false;
      score = 0; streak = 0; moves = 0; pinned = new Set();
    `);
    let steps = 0;
    while (run('autoStep()')) steps++;
    assert.equal(steps, 0, `deal ${deal} does not autosolve`);
  }
});

test('covers are dealt one card at a time, so unearthing the body takes many moves', () => {
  for (let deal = 0; deal < 30; deal++) {
    const { ops } = JSON.parse(run('JSON.stringify(generateDeal())'));
    const coverMoves = ops.filter(op => op.type === 'move' && op.from === 0);
    assert.ok(coverMoves.length >= 8, `deal ${deal} has several cover cards`);
    assert.ok(coverMoves.every(op => op.n === 1), 'cover cards do not move as runs');
  }
});

test('generated deals can be solved by reversing their construction', () => {
  for (let deal = 0; deal < 40; deal++) {
    const { cols, ops } = JSON.parse(run('JSON.stringify(generateDeal())'));
    const board = cols.map(pile => pile.map(card => ({ ...card })));
    const done = [[], []];

    for (let i = ops.length - 1; i >= 0; i--) {
      const op = ops[i];
      if (op.type === 'found') {
        const card = board[op.col].pop();
        assert.ok(card, 'foundation card is exposed');
        assert.equal(card.s, op.s);
        assert.equal(card.r, done[card.s].length + 1);
        done[card.s].push(card);
      } else {
        const pile = board[op.to];
        const moved = pile.splice(pile.length - op.n, op.n);
        assert.equal(moved.length, op.n);
        assert.ok(moved.every((card, j) => j === 0 || (moved[j - 1].r === card.r + 1 && moved[j - 1].s !== card.s)),
          'only clean runs are moved');
        const below = board[op.from].at(-1);
        assert.ok(!below || (below.r === moved[0].r + 1 && below.s !== moved[0].s));
        board[op.from].push(...moved);
      }
    }

    assert.ok(board.every(pile => pile.length === 0), `deal ${deal} solves to empty columns`);
    assert.deepEqual(done.map(pile => pile.length), [13, 13]);
  }
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
  assert.equal(run('place({kind:"free", i:0})'), false, 'cell is full');
});

test('foundations count up by suit, starting with the ace', () => {
  setup({ free: [c(1, 0), null] });
  run('sel = {kind:"free", i:0}');
  assert.equal(run('place({kind:"found", i:0})'), true);

  run('free[0] = {r:2, s:0}; sel = {kind:"free", i:0}');
  assert.equal(run('place({kind:"found", i:0})'), true);

  run('free[0] = {r:1, s:1}; sel = {kind:"free", i:0}');
  assert.equal(run('place({kind:"found", i:0})'), false, 'wrong suit');

  run('free[0] = {r:13, s:0}; sel = {kind:"free", i:0}');
  assert.equal(run('place({kind:"found", i:0})'), false, 'must start at the ace');
});

test('a long clean run moves as one group', () => {
  const long = [c(9, 1), c(8, 0), c(7, 1), c(6, 0), c(5, 1), c(4, 0), c(3, 1)];
  setup({ cols: [long, [c(10, 0)], [c(13, 0)], [c(13, 1)]] });
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
  run('tapSlot({dataset:{slot:"free", i:"1"}})');
  assert.equal(run('free[1].r'), 9);

  setup({ free: [c(1, 0), null] });
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

test('autoplay sends cards from free cells and columns home, chaining upward', () => {
  setup({ free: [c(1, 0), c(2, 0)], cols: [[c(3, 0)]] });
  run('autoStep()');
  assert.equal(run('found[0].length'), 1);
  run('autoStep()');
  assert.equal(run('found[0].length'), 2);
  run('autoStep()');
  assert.equal(run('found[0].length'), 3);
  assert.equal(run('free.every(c => c === null)'), true);
  assert.equal(run('cols[0].length'), 0);
});

test('consecutive foundation cards score 10, 20, 30; any other move resets the streak', () => {
  setup({ cols: [[c(1, 0)], [c(2, 0)], [c(3, 0)], [c(4, 0)]] });

  run('sel = {kind:"col", i:0, j:0}; place({kind:"found", i:0})');
  assert.equal(run('score'), 10);
  assert.equal(run('streak'), 1);

  run('sel = {kind:"col", i:1, j:0}; place({kind:"found", i:0})');
  assert.equal(run('score'), 30);
  assert.equal(run('streak'), 2);

  run('sel = {kind:"col", i:2, j:0}; place({kind:"col", i:0})');
  assert.equal(run('score'), 30, 'moving to a column neither scores nor loses points');
  assert.equal(run('streak'), 0, 'the chain is broken');

  run('sel = {kind:"col", i:0, j:0}; place({kind:"found", i:0})');
  assert.equal(run('score'), 40, 'the next foundation card starts a new chain');

  run('sel = {kind:"col", i:3, j:0}; place({kind:"found", i:0})');
  assert.equal(run('score'), 60);
});

test('moving a card into a free cell also breaks the score chain', () => {
  setup({ cols: [[c(1, 0)], [c(2, 0)]] });
  run('sel = {kind:"col", i:0, j:0}; place({kind:"found", i:0})');
  run('sel = {kind:"col", i:1, j:0}; place({kind:"free", i:0})');
  assert.equal(run('score'), 10);
  assert.equal(run('streak'), 0);
  assert.equal(run('free[0].r'), 2);
});

test('undo restores the score, streak and the free cell', () => {
  const rest = deck().filter(card => !(card.r === 1 && card.s === 0) && !(card.r === 2 && card.s === 0));
  const cols = [[c(2, 0)], [], [], []];
  rest.forEach((card, i) => cols[1 + (i % 3)].push(card));

  setup({ cols, free: [c(1, 0), null] });
  run('sel = {kind:"free", i:0}; place({kind:"found", i:0})');
  run('sel = {kind:"col", i:0, j:0}; place({kind:"found", i:0})');
  assert.equal(run('score'), 30);

  run('undo()');
  assert.equal(run('score'), 10);
  assert.equal(run('streak'), 1);
  assert.equal(run('found[0].length'), 1);

  run('undo()');
  assert.equal(run('score'), 0);
  assert.equal(run('streak'), 0);
  assert.equal(run('found[0].length'), 0);
  assert.equal(run('free[0].r'), 1);
});

test('the free cells and score survive a reload', () => {
  const rest = deck().filter(card => !(card.r === 1 && card.s === 0));
  const cols = [[], [], [], []];
  rest.forEach((card, i) => cols[i % 4].push(card));

  setup({ cols, free: [c(1, 0), null] });
  run('sel = {kind:"free", i:0}; place({kind:"found", i:0})');
  assert.equal(run('score'), 10);

  run('cols = [[],[],[],[]]; free = [null,null]; found = [[],[]]; score = 0; streak = 0; moves = 0; undoStack = [];');
  assert.equal(run('load()'), true);
  assert.equal(run('score'), 10);
  assert.equal(run('streak'), 1);
  assert.equal(run('found[0].length'), 1);
  assert.equal(run('free[0]'), null);
});

test('a save without the two free cells is rejected', () => {
  const cards = deck();
  const bad = { cols: Array.from({ length: 4 }, () => []), found: empty(2), moves: 0, score: 0, streak: 0 };
  cards.forEach((card, i) => bad.cols[i % 4].push(card));
  ctx.localStorage.setItem('nocell', JSON.stringify(bad));
  assert.equal(run('load()'), false);
  store.delete('nocell');
});
