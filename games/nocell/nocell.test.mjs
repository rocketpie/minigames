// Game logic tests for nocell.html: `node --test`
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

// Run the page's <script> with a stub DOM so we can drive the real move/deal code.
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
const setup = ({ cols = [], found = empty(2) } = {}) => {
  store.delete('nocell');
  run(`
    cols = ${JSON.stringify(cols4(cols))};
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
const alternates = (top, card) => top.r === card.r + 1 && (top.s === 1) !== (card.s === 1);
const runOk = run => run.every((card, i) => i === 0 || alternates(run[i - 1], card));

test('the deck is half a pack: spades and hearts only', () => {
  run('newGame()');
  const cards = JSON.parse(run('JSON.stringify(cols.flat())'));
  assert.equal(cards.length, 26);
  assert.ok(cards.every(card => card.s === 0 || card.s === 1));
  assert.equal(new Set(cards.map(card => card.s * 13 + card.r)).size, 26);
  assert.equal(run('cols.length'), 4);
  assert.equal(run('found.length'), 2);
});

test('generated deals can be solved by reversing their construction', () => {
  for (let deal = 0; deal < 40; deal++) {
    const { cols, ops } = JSON.parse(run('JSON.stringify(generateDeal())'));
    const board = cols.map(pile => pile.map(card => ({ ...card })));
    const done = [[], []];

    // Replay the build steps backwards: each one is the legal forward move that solves it.
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
        assert.ok(runOk(moved), 'only clean runs are moved');
        assert.ok(!board[op.from].length || alternates(board[op.from].at(-1), moved[0]));
        board[op.from].push(...moved);
      }
    }

    assert.ok(board.every(pile => pile.length === 0), `deal ${deal} solves to empty columns`);
    assert.deepEqual(done.map(pile => pile.length), [13, 13]);
  }
});

test('generated deals need a move before any card can go home', () => {
  for (let deal = 0; deal < 50; deal++) {
    const { cols } = JSON.parse(run('JSON.stringify(generateDeal())'));
    run(`
      cols = ${JSON.stringify(cols)};
      found = [[], []];
      sel = null; won = false;
      score = 0; streak = 0; moves = 0; pinned = new Set();
    `);
    let steps = 0;
    while (run('autoStep()')) steps++;
    assert.equal(steps, 0, `deal ${deal} does not autosolve`);
  }
});

test('there are no free cells; cards move only between the four columns and foundations', () => {
  setup({ cols: [[c(1, 0)]] });
  run('sel = {kind:"col", i:0, j:0}');
  assert.equal(run('place({kind:"free", i:0})'), false);
  assert.equal(run('place({kind:"found", i:0})'), true);
  assert.equal(run('found[0].length'), 1);
});

test('foundations count up by suit, starting with the ace', () => {
  setup({ cols: [[c(1, 0)], [c(1, 1)], [c(2, 0)]] });
  run('sel = {kind:"col", i:1, j:0}; place({kind:"found", i:0})');
  assert.equal(run('found[0].length'), 0, 'wrong suit');

  run('sel = {kind:"col", i:0, j:0}; place({kind:"found", i:0})');
  assert.equal(run('found[0].length'), 1);

  run('sel = {kind:"col", i:2, j:0}; place({kind:"found", i:0})');
  assert.equal(run('found[0].length'), 2);
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

test('autoplay cards also build the score chain', () => {
  setup({ cols: [[c(1, 0)], [c(2, 0)]] });
  run('autoStep()');
  assert.equal(run('score'), 10);
  run('autoStep()');
  assert.equal(run('score'), 30);
});

test('undo restores the score and streak from before the move', () => {
  const rest = deck().filter(card => !(card.r === 1 && card.s === 0) && !(card.r === 2 && card.s === 0));
  const cols = [[c(1, 0)], [c(2, 0)], [], []];
  rest.forEach((card, i) => cols[2 + (i % 2)].push(card));

  setup({ cols });
  run('sel = {kind:"col", i:0, j:0}; place({kind:"found", i:0})');
  run('sel = {kind:"col", i:1, j:0}; place({kind:"found", i:0})');
  assert.equal(run('score'), 30);

  run('undo()');
  assert.equal(run('score'), 10);
  assert.equal(run('streak'), 1);
  assert.equal(run('found[0].length'), 1);

  run('undo()');
  assert.equal(run('score'), 0);
  assert.equal(run('streak'), 0);
  assert.equal(run('found[0].length'), 0);
});

test('the score survives a reload', () => {
  const rest = deck().filter(card => !(card.r === 1 && card.s === 0));
  const cols = [[c(1, 0)], [], [], []];
  rest.forEach((card, i) => cols[1 + (i % 3)].push(card));

  setup({ cols });
  run('sel = {kind:"col", i:0, j:0}; place({kind:"found", i:0})');
  assert.equal(run('score'), 10);

  run('cols = [[],[],[],[]]; found = [[],[]]; score = 0; streak = 0; moves = 0; undoStack = [];');
  assert.equal(run('load()'), true);
  assert.equal(run('score'), 10);
  assert.equal(run('streak'), 1);
  assert.equal(run('found[0].length'), 1);
});

test('the old full-deck save shape is rejected', () => {
  const cards = deck();
  const bad = { cols: Array.from({ length: 8 }, () => []), free: [null, null, null, null], found: empty(4), moves: 0, score: 0, streak: 0 };
  cards.forEach((card, i) => bad.cols[i % 8].push(card));
  ctx.localStorage.setItem('nocell', JSON.stringify(bad));
  assert.equal(run('load()'), false);
  store.delete('nocell');
});
