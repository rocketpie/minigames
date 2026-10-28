// Game logic tests for lights-please.html: `node --test`
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const code = readFileSync(new URL('./lights-please.html', import.meta.url), 'utf8').match(/<script>([\s\S]*)<\/script>/)[1];
const noop = () => {};
const gradient = { addColorStop: noop };
const gctx = new Proxy({}, {
  get(t, p) {
    if (p === 'createLinearGradient' || p === 'createRadialGradient') return () => gradient;
    if (p === 'measureText') return () => ({ width: 20 });
    if (!(p in t)) t[p] = noop;
    return t[p];
  },
  set(t, p, v) { t[p] = v; return true; },
});

function el(tag) {
  const classes = new Set();
  const listeners = {};
  const e = {
    tagName: tag, style: { display: '', setProperty: noop, removeProperty: noop }, dataset: {},
    children: [], _text: '', className: '', type: '', onclick: null, disabled: false,
    clientWidth: 320, width: 320, height: 224, listeners,
    classList: {
      toggle(n, force) { const on = force === undefined ? !classes.has(n) : !!force; on ? classes.add(n) : classes.delete(n); return on; },
      add(n) { classes.add(n); }, remove(n) { classes.delete(n); }, contains(n) { return classes.has(n); },
    },
    setAttribute(k, v) { this[k] = v; },
    getAttribute(k) { return this[k]; },
    removeAttribute(k) { delete this[k]; },
    append(...cs) { this.children.push(...cs); },
    appendChild(c) { this.children.push(c); return c; },
    addEventListener(type, fn) { (listeners[type] ||= []).push(fn); },
    removeEventListener() {},
    querySelector(sel) {
      if (sel === '.lamps') return this.children.find(c => c.className === 'lamps') || null;
      return null;
    },
    getContext() { return gctx; },
    getBoundingClientRect() { return { left: 0, top: 0, width: this.clientWidth, height: this.clientWidth * 0.7 }; },
  };
  Object.defineProperty(e, 'textContent', {
    get() { return this._text; },
    set(v) { this._text = String(v); this.children = []; },
  });
  return e;
}

const els = new Map();
const getEl = id => { if (!els.has(id)) els.set(id, el(id === 'view' ? 'canvas' : 'div')); return els.get(id); };
const store = new Map();
const ctx = {
  document: { getElementById: getEl, createElement: el, body: { append: noop } },
  addEventListener: noop, removeEventListener: noop, devicePixelRatio: 1, console,
  localStorage: { getItem: k => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)) },
};
vm.createContext(ctx);
vm.runInContext(code, ctx);
const ev = expr => vm.runInContext(expr, ctx);

const LEVELS = ev('LEVELS');
const G = ev('W');

// The intended minimum number of flips, one per house.
const PAR = [2, 3, 4, 5, 5];

function solve(levelIndex) {
  const L = LEVELS[levelIndex], n = L.rooms.length, m = L.switches.length;
  const start = L.lit.reduce((s, i) => s | (1 << i), 0);
  const all = (1 << n) - 1;
  const seen = new Map([[start, []]]);
  let frontier = [start];
  const uniform = s => s === 0 || s === all;
  if (uniform(start)) return { start, best: 0, moves: [] };
  for (let d = 1; d <= m; d++) {
    const next = [];
    for (const s of frontier) {
      for (let i = 0; i < m; i++) {
        let t = s;
        for (const r of L.switches[i]) t ^= 1 << r;
        if (seen.has(t)) continue;
        const path = seen.get(s).concat(i);
        seen.set(t, path);
        if (uniform(t)) return { start, best: d, moves: path };
        next.push(t);
      }
    }
    frontier = next;
  }
  return { start, best: Infinity, moves: [] };
}

test('every level is a well-formed, different house with valid switches', () => {
  assert.equal(LEVELS.length, 5);
  const shapes = new Set();
  for (let n = 0; n < LEVELS.length; n++) {
    const L = LEVELS[n];
    shapes.add(L.rooms.map(r => `${r.x},${r.y},${r.w},${r.h}`).join('|'));
    assert.ok(L.rooms.length >= 4, `level ${n} has rooms`);
    for (const r of L.rooms) {
      assert.ok(r.x >= 0 && r.y >= 0 && r.x + r.w <= G && r.y + r.h <= 700, `level ${n} room in bounds`);
      assert.ok(r.w > 60 && r.h > 60, `level ${n} room is usable`);
      assert.ok(r.name && ev('STYLES')[r.type], `level ${n} room has a style`);
    }
    assert.ok(L.doors.length >= 4, `level ${n} has doors`);
    assert.ok(L.switches.length >= 4, `level ${n} has switches`);
    for (const g of L.switches) {
      assert.ok(g.length >= 1 && g.length <= 4, `level ${n} switch flips 1-4 lamps`);
      assert.equal(new Set(g).size, g.length, `level ${n} switch group has no duplicates`);
      assert.ok(g.every(i => Number.isInteger(i) && i >= 0 && i < L.rooms.length), `level ${n} switch points at a room`);
    }
    const covered = new Set(L.switches.flat());
    assert.equal(covered.size, L.rooms.length, `level ${n} every room can be switched`);
    const startMask = L.lit.reduce((s, i) => s | (1 << i), 0);
    assert.notEqual(startMask, 0, `level ${n} does not start dark`);
    assert.notEqual(startMask, (1 << L.rooms.length) - 1, `level ${n} does not start lit`);
  }
  assert.equal(shapes.size, LEVELS.length, 'every house has a different floor plan');
});

test('every level can be finished in its intended number of moves', () => {
  for (let n = 0; n < LEVELS.length; n++) {
    const s = solve(n);
    assert.equal(s.best, PAR[n], `level ${n} shortest solution`);
  }
});

test('switches toggle exactly their group and undo restores the house', () => {
  ev('loadLevel(0)');
  const before = Array.from(ev('rooms.map(r => r.on)'));
  const group = Array.from(ev('switches[0].group'));
  assert.equal(ev('pressSwitch(0)'), true);
  const after = Array.from(ev('rooms.map(r => r.on)'));
  for (let i = 0; i < before.length; i++) {
    assert.equal(after[i], group.includes(i) ? !before[i] : before[i], `room ${i}`);
  }
  assert.equal(ev('moves'), 1);
  assert.equal(ev('history.length'), 1);
  assert.equal(ev('switches[0].on'), true);
  assert.equal(ev('undoTurn()'), true);
  assert.deepEqual(Array.from(ev('rooms.map(r => r.on)')), before);
  assert.equal(ev('moves'), 0);
  assert.equal(ev('history.length'), 0);
  assert.equal(ev('switches[0].on'), false);
});

test('the house is won only when every room agrees, either way', () => {
  ev('loadLevel(0)');
  assert.equal(ev('uniform()'), false);
  ev('rooms.forEach(r => { r.on = true; r.target = 1; })');
  assert.equal(ev('uniform()'), true);
  assert.equal(ev('uniformOn()'), true);
  ev('rooms.forEach(r => { r.on = false; r.target = 0; })');
  assert.equal(ev('uniform()'), true);
  assert.equal(ev('uniformOn()'), false);
});

test('pressing a shortest solution wins the level and raises the overlay', () => {
  ev('loadLevel(0); best = [];');
  const sol = solve(0);
  assert.equal(sol.best, PAR[0]);
  for (const i of sol.moves) ev(`pressSwitch(${i})`);
  assert.equal(ev('phase'), 'won');
  assert.equal(ev('best[0]'), sol.best, 'the win records the best move count');
  assert.ok(ev('litRooms()') === 0 || ev('litRooms()') === ev('rooms.length'));
  assert.equal(ev('overlayShown'), false);
  ev('update(1.2)');
  assert.equal(ev('overlayShown'), true);
  assert.equal(getEl('overlay').style.display, 'flex');
  assert.doesNotThrow(() => ev('drawScene()'), 'the all-dark win still draws');
});

test('reset puts every room and switch back, and clears the move history', () => {
  ev('loadLevel(1)');
  const start = Array.from(ev('rooms.map(r => r.on)'));
  ev('pressSwitch(1)');
  ev('pressSwitch(4)');
  assert.ok(ev('moves') > 0);
  ev('resetLevel()');
  assert.deepEqual(Array.from(ev('rooms.map(r => r.on)')), start);
  assert.equal(ev('moves'), 0);
  assert.equal(ev('history.length'), 0);
  assert.ok(ev('switches.every(s => !s.on)'));
  assert.equal(ev('phase'), 'play');
});

test('windows land on outside walls and stay inside the canvas', () => {
  for (let n = 0; n < LEVELS.length; n++) {
    ev(`loadLevel(${n})`);
    const wins = Array.from(ev('windows'));
    assert.ok(wins.length >= 4, `level ${n} has windows`);
    for (const w of wins) {
      assert.ok(w.x >= 0 && w.y >= 0 && w.x + w.w <= G && w.y + w.h <= 700, `level ${n} window in bounds`);
      assert.ok(w.room >= 0 && w.room < LEVELS[n].rooms.length, `level ${n} window belongs to a room`);
      assert.ok(ev(`rooms[${w.room}]`).ext[w.side].length > 0, `level ${n} window is on an outside wall`);
    }
  }
});

test('drawing every level never throws', () => {
  for (let n = 0; n < LEVELS.length; n++) {
    ev(`loadLevel(${n})`);
    assert.doesNotThrow(() => { ev('update(.016)'); ev('drawScene()'); }, `level ${n}`);
  }
  ev('loadLevel(2)');
  assert.doesNotThrow(() => ev('pressSwitch(0)'));
  assert.doesNotThrow(() => { ev('update(.3)'); ev('drawScene()'); });
});

test('the hidden room buttons are accessible', () => {
  ev('loadLevel(2)');
  const board = getEl('board');
  assert.equal(board.children.length, LEVELS[2].rooms.length);
  for (const b of board.children) {
    assert.equal(b.tagName, 'button');
    assert.match(b.getAttribute('aria-label'), /^.+ light switch$/);
    assert.equal(b.getAttribute('aria-pressed'), 'false');
  }
});

test('every room owns a switch that includes it', () => {
  for (let n = 0; n < LEVELS.length; n++) {
    const L = LEVELS[n];
    assert.equal(L.switches.length, L.rooms.length, `level ${n} has one switch per room`);
    L.switches.forEach((g, i) => assert.ok(g.includes(i), `level ${n} switch ${i} includes its room`));
  }
});

test('tapping a room on the canvas flips that room\'s circuit', () => {
  ev('loadLevel(0)');
  const view = getEl('view');
  const room = ev('rooms[2]');
  const group = Array.from(ev('switches[2].group'));
  const before = Array.from(ev('rooms.map(r => r.on)'));
  view.listeners.click[0]({
    clientX: (room.x + room.w / 2) * view.clientWidth / G,
    clientY: (room.y + room.h / 2) * view.clientWidth * 0.7 / 700,
  });
  const after = Array.from(ev('rooms.map(r => r.on)'));
  for (let i = 0; i < before.length; i++) {
    assert.equal(after[i], group.includes(i) ? !before[i] : before[i], `room ${i}`);
  }
  assert.equal(ev('moves'), 1);
  assert.equal(ev('tapAt(1, 1)'), false, 'tapping outside the house does nothing');
  assert.equal(ev('moves'), 1);
});

test('clicking a switch button drives the game', () => {
  ev('loadLevel(0)');
  const b = getEl('board').children[1];
  assert.ok(b.listeners.click && b.listeners.click.length);
  b.listeners.click[0]();
  assert.equal(ev('moves'), 1);
  assert.equal(ev('switches[1].on'), true);
});
