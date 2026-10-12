// Game logic tests for icewall.html: `node --test`
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

// Run the page's <script> with a stub DOM so we can drive the real logic.
const code = readFileSync(new URL('./icewall.html', import.meta.url), 'utf8').match(/<script>([\s\S]*)<\/script>/)[1];
const el = () => ({
  style: {}, dataset: {}, textContent: '', className: '',
  classList: { add() {}, remove() {} },
  append() {}, appendChild: c => c, remove() {}, addEventListener() {}, querySelectorAll: () => [],
});
const ctx = {
  document: { getElementById: el, createElement: el, body: { append() {} } },
  addEventListener() {}, removeEventListener() {}, setTimeout: fn => fn(), console,
};
vm.createContext(ctx);
vm.runInContext(code, ctx);
const ev = expr => vm.runInContext(expr, ctx);

test('generated shapes are connected blobs of 4-6 cells', () => {
  for (const size of [4, 5, 6]) {
    for (let n = 0; n < 100; n++) {
      const shape = Array.from(ev(`genShape(${size})`), p => Array.from(p));
      assert.equal(shape.length, size, 'cell count');
      assert.equal(Math.min(...shape.map(p => p[0])), 0, 'normalised row');
      assert.equal(Math.min(...shape.map(p => p[1])), 0, 'normalised col');
      const set = new Set(shape.map(p => p.join(',')));
      assert.equal(set.size, size, 'no duplicate cells');
      const seen = new Set([shape[0].join(',')]);
      const queue = [shape[0]];
      while (queue.length) {
        const [r, c] = queue.pop();
        for (const [dr, dc] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const k = `${r + dr},${c + dc}`;
          if (set.has(k) && !seen.has(k)) { seen.add(k); queue.push([r + dr, c + dc]); }
        }
      }
      assert.equal(seen.size, size, 'fully connected');
    }
  }
});

test('a tray holds three shapes of 4-6 cells', () => {
  const tray = Array.from(ev('newTray()'));
  assert.equal(tray.length, 3);
  assert.ok(tray.every(s => s.length >= 4 && s.length <= 6));
});

test('fits respects the board edges and occupied cells', () => {
  ev('grid = new Uint8Array(SIZE)');
  assert.equal(ev('fits([[0,0]], 0, 0)'), true);
  assert.equal(ev('fits([[0,0]], 0, 15)'), true);
  assert.equal(ev('fits([[0,0]], 0, 16)'), false, 'right edge');
  assert.equal(ev('fits([[0,0]], -1, 0)'), false, 'top edge');
  assert.equal(ev('fits([[0,0],[1,0]], 22, 0)'), true, 'spanning bottom rows');
  assert.equal(ev('fits([[0,0],[1,0]], 23, 0)'), false, 'below the floor');
  ev('grid[5 * W + 5] = 1');
  assert.equal(ev('fits([[0,0]], 5, 5)'), false, 'occupied cell');
});

test('a completed row clears', () => {
  ev('grid = new Uint8Array(SIZE)');
  assert.equal(ev('applyPlace([[0,0]], 5, 5)'), 0, 'incomplete row stays');
  ev('grid = new Uint8Array(SIZE); for (let c = 0; c < 15; c++) grid[23 * W + c] = 1');
  assert.equal(ev('applyPlace([[0,0]], 23, 15)'), 1);
  assert.equal(ev('grid.every(v => !v)'), true, 'the only row was the cleared one');
});

test('several completed rows clear together', () => {
  ev('grid = new Uint8Array(SIZE)');
  ev('for (const r of [22, 23]) for (let c = 0; c < 15; c++) grid[r * W + c] = 1');
  assert.equal(ev('applyPlace([[0,0],[1,0]], 22, 15)'), 2);
  assert.equal(ev('grid.every(v => !v)'), true);
});

test('a placement that does not fit is rejected', () => {
  ev('grid = new Uint8Array(SIZE); grid[0] = 1');
  assert.equal(ev('applyPlace([[0,0]], 0, 0)'), -1);
});

test('multiplier grows on multi-clears and decays on single clears', () => {
  const W = ev('W');
  ev('mult = 1; score = 0');
  assert.equal(ev('award(2)'), 2 * W * 10 * 2);
  assert.equal(ev('mult'), 2);
  assert.equal(ev('award(3)'), 3 * W * 10 * 4, '2 + (3-1) rows');
  assert.equal(ev('mult'), 4);
  assert.equal(ev('award(1)'), 1 * W * 10 * 3);
  assert.equal(ev('award(1)'), 1 * W * 10 * 2);
  assert.equal(ev('award(1)'), 1 * W * 10 * 1);
  assert.equal(ev('award(1)'), 1 * W * 10 * 1, 'never below ×1');
  assert.equal(ev('award(0)'), 0, 'no clear, no points');
  assert.equal(ev('mult'), 1);
});

test('canPlace finds a home or reports none', () => {
  ev('grid = new Uint8Array(SIZE).fill(1)');
  assert.equal(ev('canPlace([[0,0]])'), false);
  ev('grid[7 * W + 3] = 0');
  assert.equal(ev('canPlace([[0,0]])'), true);
  assert.equal(ev('canPlace([[0,0],[0,1]])'), false, 'needs two adjacent cells');
});
