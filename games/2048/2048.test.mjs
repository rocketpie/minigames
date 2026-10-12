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
const ctx = { document: { getElementById: el, createElement: el }, addEventListener() {}, setTimeout: fn => fn(), console };
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
