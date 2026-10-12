// Game logic tests for icewall.html: `node --test`
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

// Run the page's <script> with a stub DOM so we can drive the real logic.
const code = readFileSync(new URL('./icewall.html', import.meta.url), 'utf8').match(/<script>([\s\S]*)<\/script>/)[1];
const el = () => ({
  style: { setProperty() {} }, dataset: {}, textContent: '', className: '',
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
const W = ev('W'), H = ev('H');

test('the shape set is well-formed: connected, normalised, 4-6 cells', () => {
  const shapes = Array.from(ev('SHAPES'), s => Array.from(s, p => Array.from(p)));
  assert.ok(shapes.length >= 7, 'I, L, reverse L, T, block, 2x3, 3x2');
  for (const shape of shapes) {
    assert.ok(shape.length >= 4 && shape.length <= 6, 'cell count in range');
    assert.equal(Math.min(...shape.map(p => p[0])), 0, 'normalised row');
    assert.equal(Math.min(...shape.map(p => p[1])), 0, 'normalised col');
    const set = new Set(shape.map(p => p.join(',')));
    assert.equal(set.size, shape.length, 'no duplicate cells');
    const seen = new Set([shape[0].join(',')]);
    const queue = [shape[0]];
    while (queue.length) {
      const [r, c] = queue.pop();
      for (const [dr, dc] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const k = `${r + dr},${c + dc}`;
        if (set.has(k) && !seen.has(k)) { seen.add(k); queue.push([r + dr, c + dc]); }
      }
    }
    assert.equal(seen.size, shape.length, 'fully connected');
  }
});

test('a tray holds three shapes from the set', () => {
  const shapes = Array.from(ev('SHAPES'));
  const tray = Array.from(ev('newTray()'));
  assert.equal(tray.length, 3);
  assert.ok(tray.every(s => shapes.includes(s)), 'each drawn from SHAPES');
});

test('fits respects the board edges and occupied cells', () => {
  ev('grid = new Uint8Array(SIZE)');
  assert.equal(ev('fits([[0,0]], 0, 0)'), true);
  assert.equal(ev(`fits([[0,0]], 0, ${W - 1})`), true, 'bottom-right corner cell');
  assert.equal(ev(`fits([[0,0]], 0, ${W})`), false, 'past the right edge');
  assert.equal(ev('fits([[0,0]], -1, 0)'), false, 'past the top edge');
  assert.equal(ev(`fits([[0,0],[1,0]], ${H - 2}, 0)`), true, 'spanning the bottom rows');
  assert.equal(ev(`fits([[0,0],[1,0]], ${H - 1}, 0)`), false, 'below the floor');
  ev('grid[5 * W + 5] = 1');
  assert.equal(ev('fits([[0,0]], 5, 5)'), false, 'occupied cell');
});

test('a completed row clears', () => {
  ev('grid = new Uint8Array(SIZE)');
  assert.equal(ev('applyPlace([[0,0]], 5, 5)'), 0, 'incomplete row stays');
  ev(`grid = new Uint8Array(SIZE); for (let c = 0; c < ${W - 1}; c++) grid[${H - 1} * W + c] = 1`);
  assert.equal(ev(`applyPlace([[0,0]], ${H - 1}, ${W - 1})`), 1);
  assert.equal(ev('grid.every(v => !v)'), true, 'the only row was the cleared one');
});

test('several completed rows clear together', () => {
  ev('grid = new Uint8Array(SIZE)');
  ev(`for (const r of [${H - 2}, ${H - 1}]) for (let c = 0; c < ${W - 1}; c++) grid[r * W + c] = 1`);
  assert.equal(ev(`applyPlace([[0,0],[1,0]], ${H - 2}, ${W - 1})`), 2);
  assert.equal(ev('grid.every(v => !v)'), true);
});

test('a placement that does not fit is rejected', () => {
  ev('grid = new Uint8Array(SIZE); grid[0] = 1');
  assert.equal(ev('applyPlace([[0,0]], 0, 0)'), -1);
});

test('multiplier grows on multi-clears and decays on single clears', () => {
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

test('clearing rows keeps the block layer in sync with the grid', () => {
  // row 12 full, row 10 full bar col 9; survivors at rows 8, 11, 14 (col 0).
  // dropping at (10,9) completes row 10, so rows 10 and 12 clear together.
  ev(`grid = new Uint8Array(SIZE); blocks = Array(SIZE).fill(null);
      for (let c = 0; c < W; c++)     { grid[12 * W + c] = 1; addBlock(12, c); }
      for (let c = 0; c < W - 1; c++) { grid[10 * W + c] = 1; addBlock(10, c); }
      for (const r of [8, 11, 14]) { addBlock(r, 0); grid[r * W] = 1; }
      drop(0, [[0,0]], 10, W - 1);`);
  assert.equal(ev('blocks.every((b, i) => (b !== null) === (grid[i] === 1))'), true, 'every block sits on a filled cell');
  // survivors fall by the number of cleared rows below them: 8->10, 11->12, 14 stays
  assert.ok(ev(`blocks[10*W] && blocks[12*W] && blocks[14*W]`), 'survivors moved to their new rows');
  assert.ok(ev(`!blocks[8*W] && !blocks[11*W]`), 'old positions vacated');
});

test('a drop with a used slot still reports game state (no null crash)', () => {
  ev('grid = new Uint8Array(SIZE); blocks = Array(SIZE).fill(null); tray = newTray();');
  ev('drop(0, [[0,0]], 0, 0)');
  assert.equal(ev('typeof over'), 'boolean');
});
