// Game logic tests for 2048.html: `node --test`
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

// Run the page's <script> with a stub DOM so we can drive the real move/settle code.
const code = readFileSync(new URL('./2048.html', import.meta.url), 'utf8').match(/<script>([\s\S]*)<\/script>/)[1];
const el = () => ({
  style: {}, dataset: {}, textContent: '', offsetWidth: 0,
  classList: { add() {}, remove() {} },
  append() {}, appendChild: c => c, remove() {}, addEventListener() {}, querySelectorAll: () => [],
});
const store = new Map();
const ctx = { document: { getElementById: el, createElement: el }, addEventListener() {}, setTimeout: fn => fn(), console,
  prompt: () => 'ana', alert() {},
  localStorage: { getItem: k => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)) } };
vm.createContext(ctx);
vm.runInContext(code, ctx);

const play = (cells, dir) => {
  vm.runInContext(`
    tiles = []; absorbed = []; score = 0;
    board = ${JSON.stringify(cells)}.map((v, i) => v ? createTile(v, (i / 4) | 0, i % 4) : null);
    globalThis.moved = move(${JSON.stringify(dir)});
    settle();
  `, ctx);
  return {
    cells: Array.from(vm.runInContext('board.map(t => t ? t.v : 0)', ctx)),
    moved: vm.runInContext('moved', ctx),
    score: vm.runInContext('score', ctx),
  };
};

const empty = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];

test('merges equal neighbours once per move', () => {
  assert.deepEqual(play([2, 2, 2, 2, ...empty.slice(4)], 'left').cells, [4, 4, 0, 0, ...empty.slice(4)]);
  assert.deepEqual(play([2, 2, 4, 4, ...empty.slice(4)], 'left').cells, [4, 8, 0, 0, ...empty.slice(4)]);
});

test('scores each merge', () => {
  assert.equal(play([4, 4, 8, 8, ...empty.slice(4)], 'left').score, 24);
});

test('merges vertically', () => {
  assert.deepEqual(play([2, 0, 0, 0, 2, 0, 0, 0, ...empty.slice(8)], 'up').cells.slice(0, 4), [4, 0, 0, 0]);
  assert.deepEqual(play([0, 0, 0, 2, 0, 0, 0, 2, ...empty.slice(8)], 'down').cells.slice(12), [0, 0, 0, 4]);
});

test('slides without merging and reports the move', () => {
  assert.equal(play([0, 0, 0, 2, ...empty.slice(4)], 'left').moved, true);
});

test('a full, unmergeable board cannot move', () => {
  const full = [2, 4, 8, 16, 32, 64, 128, 256, 512, 1024, 2, 4, 8, 16, 32, 64];
  assert.equal(play(full, 'left').moved, false);
});

test('tiles already against the wall report no move', () => {
  assert.equal(play([2, 0, 0, 0, ...empty.slice(4)], 'left').moved, false);
});

test('saves after a move and restores that board', () => {
  play([2, 2, ...empty.slice(2)], 'left');   // -> 4 at cell 0, score 4
  vm.runInContext('addTile(); save()', ctx);
  const saved = JSON.parse(ctx.localStorage.getItem('2048'));
  assert.equal(saved.cells[0], 4);
  assert.equal(saved.score, 4);
  assert.equal(saved.cells.filter(Boolean).length, 2);

  vm.runInContext('score = 999; board = []; init(load())', ctx);
  assert.deepEqual(Array.from(vm.runInContext('board.map(t => t ? t.v : 0)', ctx)), saved.cells);
  assert.equal(vm.runInContext('score', ctx), 4);
});

test('a new game ignores the saved board', () => {
  vm.runInContext('init(null)', ctx);
  assert.equal(vm.runInContext('score', ctx), 0);
  assert.equal(Array.from(vm.runInContext('board.map(t => t ? t.v : 0)', ctx)).filter(Boolean).length, 2);
});

test('high scores sort high to low and keep the top 10', () => {
  const list = () => Array.from(vm.runInContext('scores.map(e => e.score)', ctx));

  vm.runInContext('scores = []; [10, 50, 20, 5, 30].forEach(p => addScore("p", p))', ctx);
  assert.deepEqual(list(), [50, 30, 20, 10, 5]);
  assert.deepEqual(JSON.parse(ctx.localStorage.getItem('2048-scores')).map(e => e.score), [50, 30, 20, 10, 5]);

  vm.runInContext('scores = []; for (let i = 1; i <= 12; i++) addScore("p" + i, i)', ctx);
  assert.deepEqual(list(), [12, 11, 10, 9, 8, 7, 6, 5, 4, 3]);
});

test('a game over records the score once, restoring does not', () => {
  vm.runInContext('Math.random = () => 0.5; scores = []; init(null)', ctx);
  // Row 4 can slide left; the tile added into the hole makes a full, unmergeable board.
  vm.runInContext(`
    tiles = [];
    board = [2,4,2,4, 4,2,4,2, 2,4,2,4, 0,4,2,4].map((v, i) =>
      v ? { v, r: (i / 4) | 0, c: i % 4, el: document.createElement() } : null);
  `, ctx);
  vm.runInContext('turn("left")', ctx);
  assert.equal(vm.runInContext('over', ctx), true);
  assert.deepEqual(Array.from(vm.runInContext('scores.map(e => e.name)', ctx)), ['ana']);
  assert.deepEqual(JSON.parse(ctx.localStorage.getItem('2048-scores')).map(e => e.name), ['ana']);

  // Reloading the finished game must not ask again or add a second entry.
  vm.runInContext('init(load())', ctx);
  assert.equal(vm.runInContext('over', ctx), true);
  assert.deepEqual(Array.from(vm.runInContext('scores.map(e => e.name)', ctx)), ['ana']);
});
