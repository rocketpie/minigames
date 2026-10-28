// Game logic tests for drone-printer.html: `node --test`
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

// Run the page's <script> with a stub DOM so we can drive the real painting logic.
const code = readFileSync(new URL('./drone-printer.html', import.meta.url), 'utf8').match(/<script>([\s\S]*)<\/script>/)[1];
const noop = () => {};
const gradient = { addColorStop: noop };
const gctx = { fillRect: noop, clearRect: noop, beginPath: noop, arc: noop, fill: noop, stroke: noop, strokeRect: noop, moveTo: noop, lineTo: noop, arcTo: noop, quadraticCurveTo: noop, closePath: noop, clip: noop, save: noop, restore: noop, translate: noop, rotate: noop, drawImage: noop, createLinearGradient: () => gradient, createRadialGradient: () => gradient, fillStyle: '', strokeStyle: '', lineWidth: 1, globalAlpha: 1 };
const el = () => {
  const e = {
    style: { setProperty() {}, display: '' }, dataset: {}, className: '', clientWidth: 320, width: 320, height: 320,
    children: [], classList: { add() {}, remove() {} }, append(...cs) { this.children.push(...cs); },
    appendChild(c) { this.children.push(c); return c; }, remove() {}, addEventListener() {}, querySelectorAll: () => [],
    getContext: () => gctx,
  };
  Object.defineProperty(e, 'textContent', {
    get() { return this._text || ''; },
    set(v) { this._text = String(v); this.children = []; },
  });
  return e;
};
const elements = new Map();
const getEl = id => { if (!elements.has(id)) elements.set(id, el()); return elements.get(id); };
const store = new Map();
const ctx = {
  document: { getElementById: getEl, createElement: el, body: { append() {} } },
  addEventListener() {}, removeEventListener() {}, setTimeout: fn => fn(), console,
  localStorage: { getItem: k => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)) },
};
vm.createContext(ctx);
vm.runInContext(code, ctx);
const ev = expr => vm.runInContext(expr, ctx);
const G = ev('G'), C = Math.floor(G / 2), CENTRE = C * G + C;
const MAX_FLY = ev('MAX_FLY');

// Start from an empty board and let the caller lay out a couple of fields.
const field = spec => ev(`
  (() => {
    needA = new Int8Array(G * G).fill(-1); needB = new Int8Array(G * G).fill(-1);
    gotA = new Uint8Array(G * G); gotB = new Uint8Array(G * G); paint = new Uint8Array(G * G);
    ${spec}
    paintedCount = 0; totalTargets = 0;
    for (let i = 0; i < G * G; i++) if (needA[i] >= 0) totalTargets++;
    flying = []; parked = [null, null, null]; phase = 'play';
  })()
`);

test('every level image is a well-formed G x G grid of known colours', () => {
  for (let n = 0; n < ev('LEVELS.length'); n++) {
    const art = Array.from(ev(`LEVELS[${n}].art`));
    assert.equal(art.length, G, `level ${n} row count`);
    for (const row of art) {
      assert.equal(row.length, G, `level ${n} row width`);
      assert.match(row, /^[.rbgwkpoi]+$/, `level ${n} uses known colours`);
    }
  }
});

test('every level needs 10-40 drones whose magazines add up to the image', () => {
  for (let n = 0; n < ev('LEVELS.length'); n++) {
    const counts = Array.from(ev(`parseArt(LEVELS[${n}].art).counts`));
    const drones = Array.from(ev(`splitCounts(parseArt(LEVELS[${n}].art).counts)`), d => ({ color: d.color, mag: d.mag }));
    assert.ok(drones.length >= 10 && drones.length <= 40, `level ${n} drone count ${drones.length}`);
    assert.ok(drones.every(d => d.mag > 0), `level ${n} no empty drones`);
    for (let c = 0; c < counts.length; c++) {
      const sum = drones.filter(d => d.color === c).reduce((a, d) => a + d.mag, 0);
      assert.equal(sum, counts[c], `level ${n} colour ${c} shots line up with its pixels`);
    }
  }
});

test('mixed fields ask for both colours and every level uses some', () => {
  const used = ev('LEVELS.map(l => l.art.join("")).join("")');
  assert.match(used, /p/, 'a purple (red+blue) field exists');
  const m = ev('MIXES.p');
  assert.deepEqual([m.a, m.b], [ev('idxOf.r'), ev('idxOf.b')], 'purple is red + blue');
  assert.equal(ev('MIXHEX[idxOf.r * KEYS.length + idxOf.b]'), ev('MIXES.p.hex'));
});

test('a ray starts at the centre, points outward and never crosses to the far side', () => {
  const right = Array.from(ev('rayCells(0)'));
  assert.equal(right[0], CENTRE, 'first cell is the centre');
  assert.ok(right.includes(CENTRE + 3), 'reaches out to the right');
  assert.ok(!right.includes(CENTRE - 1), 'does not reach the left side');
  const down = Array.from(ev(`rayCells(${Math.PI / 2})`));
  assert.equal(down[0], CENTRE);
  assert.ok(down.includes((C + 2) * G + C), 'reaches downward (canvas y grows down)');
  assert.ok(!down.includes((C - 2) * G + C), 'does not reach upward');
});

test('the flight rail is a rounded square while keeping symmetric headings', () => {
  const axis = ev('orbitPoint(0, { cx: 0, cy: 0, orbit: 100 })');
  const corner = ev('orbitPoint(Math.PI / 4, { cx: 0, cy: 0, orbit: 100 })');
  const opposite = ev('orbitPoint(5 * Math.PI / 4, { cx: 0, cy: 0, orbit: 100 })');
  assert.equal(axis.x, 100, 'the straight sections reach the full rail width');
  assert.ok(corner.x > 70 && corner.x < 90, 'the diagonal bends inward into a rounded corner');
  assert.ok(Math.abs(corner.x - corner.y) < 1e-9, 'the corner is symmetric');
  assert.ok(Math.abs(opposite.x + corner.x) < 1e-9);
  assert.ok(Math.abs(opposite.y + corner.y) < 1e-9);
});

test('reservoirs stay colored at low ammo and nearly top off with full magazines', () => {
  assert.ok(ev('reservoirFill(4)') < .55, 'under five shots is visibly lower');
  assert.ok(ev('reservoirFill(16)') > .8, 'over fifteen shots is nearly full');
  assert.equal(ev('reservoirFill(30)'), .9, 'the tank never overflows its glass');
});

test('a drone only prints the most central field that still owes its colour', () => {
  field(`needA[${CENTRE}] = 0; needA[${CENTRE + 1}] = 1; needA[${CENTRE + 2}] = 0;`);
  const red = { color: 0, ang: 0 }, blue = { color: 1, ang: 0 }, other = { color: 2, ang: 0 };
  assert.equal(ev('shootTarget')(red), CENTRE, 'red takes the centre');
  assert.equal(ev('shootTarget')(blue), -1, 'blue is blocked by the red centre');
  assert.equal(ev('shootTarget')(other), -1, 'a colour not owed prints nothing');
  ev(`applyShot(${CENTRE}, 0)`);
  assert.equal(ev('shootTarget')(red), -1, 'red cannot print past the blue cell');
  assert.equal(ev('shootTarget')(blue), CENTRE + 1, 'blue prints the next cell');
  assert.equal(ev('shootTarget')({ color: 0, ang: Math.PI }), -1, 'facing away, red reaches nothing');
});

test('a mixed field needs two different shots and only then turns the mixed colour', () => {
  field(`needA[${CENTRE}] = 0; needB[${CENTRE}] = 1;`); // red + blue = purple
  const red = { color: 0, ang: 0 }, blue = { color: 1, ang: 0 };
  assert.equal(ev('shootTarget')(red), CENTRE, 'red is owed');
  assert.equal(ev('shootTarget')(blue), CENTRE, 'blue is owed too');
  assert.equal(ev('shootTarget')({ color: 2, ang: 0 }), -1, 'green is not owed');
  ev(`applyShot(${CENTRE}, 0)`);
  assert.equal(ev(`paint[${CENTRE}]`), 0, 'one shot is not enough');
  assert.equal(ev(`splatColor(${CENTRE})`), '#e8453c', 'shows the first colour for now');
  assert.equal(ev('shootTarget')(red), -1, 'red is already in');
  assert.equal(ev('shootTarget')(blue), CENTRE, 'blue is still owed');
  ev(`applyShot(${CENTRE}, 1)`);
  assert.equal(ev(`paint[${CENTRE}]`), 1, 'both shots finish the field');
  assert.equal(ev(`splatColor(${CENTRE})`), '#8a4fd0', 'and it turns purple');
  assert.equal(ev('paintedCount'), 1);
});

test('the frontier reports every colour still owed by the centre', () => {
  field(`needA[${CENTRE}] = 0;`);
  assert.deepEqual(Array.from(ev('frontierColors()')), [0], 'single: only red');
  field(`needA[${CENTRE}] = 0; needB[${CENTRE}] = 1;`);
  assert.deepEqual(Array.from(ev('frontierColors()')).sort(), [0, 1], 'mixed: red and blue');
  ev(`applyShot(${CENTRE}, 0)`);
  assert.deepEqual(Array.from(ev('frontierColors()')), [1], 'after red, only blue remains');
});

test('three landing pads hold drones; a fourth landing crashes', () => {
  ev('flying = []; parked = [null, null, null]; phase = "play";');
  ev('land({ color: 0, mag: 1 }); land({ color: 1, mag: 2 }); land({ color: 2, mag: 3 });');
  assert.equal(ev('parked.every(Boolean)'), true, 'all pads taken');
  assert.equal(ev('phase'), 'play');
  ev('land({ color: 3, mag: 1 })');
  assert.equal(ev('phase'), 'over', 'no pad free, so it crashes');
});

test('a parked drone can be relaunched by tapping the drone, not the empty pad', () => {
  ev("phase = 'play'; flying = []; parked = [{ color: 0, mag: 4 }, null, null]; renderPads();");
  const pad = getEl('pad0');
  pad.onpointerdown({ target: pad, preventDefault: noop });
  assert.ok(ev('parked[0]'), 'tapping the landing marker does nothing');
  pad.onpointerdown({ target: pad.children[0], preventDefault: noop });
  assert.equal(ev('parked[0]'), null, 'tapping the parked drone relaunches it');
  assert.equal(ev('flying.length'), 1);
});

test('up to five drones fly at once, and parked drones can be re-sent', () => {
  assert.equal(MAX_FLY, 5);
  ev(`
    phase = 'play'; flying = []; parked = [null, null, null];
    lanes = [[{ color: 0, mag: 5 }, { color: 4, mag: 5 }], [{ color: 1, mag: 5 }, { color: 4, mag: 5 }], [{ color: 2, mag: 5 }, { color: 3, mag: 5 }]];
  `);
  for (const l of [0, 1, 2, 0, 1]) assert.equal(ev(`launchFromLane(${l})`), true);
  assert.equal(ev('flying.length'), 5);
  ev('lanes[2].push({ color: 0, mag: 5 })');
  assert.equal(ev('launchFromLane(2)'), false, 'sixth drone refused');
  ev('parked[0] = { color: 4, mag: 9 }');
  assert.equal(ev('relaunchParked(0)'), false, 'padding a parked drone also refused');
  ev('flying.pop()');
  assert.equal(ev('relaunchParked(0)'), true, 'a freed slot lets a parked drone go');
});

test('emptying a magazine mid-lap makes the drone fly away instead of landing', () => {
  field(`needA[${CENTRE}] = 0;`);
  ev('score = 0; level = 0; totalDrones = 1; best = 0; const d = { color: 0, mag: 1 }; startFlight(d); d.ang = 0; d.cd = 0;');
  ev('advance(0.02)');
  assert.equal(ev('phase'), 'won', 'the single-cell image completes');
  assert.equal(ev('paintedCount'), 1);
});

test('a whole level is printable: every field can be reached from the centre out', () => {
  for (let n = 0; n < ev('LEVELS.length'); n++) {
    ev(`loadLevel(${n})`);
    const bad = ev(`
      (() => {
        const c = (G - 1) / 2;
        const cells = [];
        for (let i = 0; i < G * G; i++) if (needA[i] >= 0) cells.push(i);
        const done = new Set();
        for (let pass = 0; pass <= cells.length; pass++) {
          let progress = false;
          for (const i of cells) {
            if (done.has(i)) continue;
            const ang = Math.atan2(((i / G) | 0) - c, (i % G) - c);
            for (let k = -12; k <= 12; k++) {
              const ray = rayCells(ang + k * 0.01);
              let first = -1;
              for (const j of ray) if (needA[j] >= 0 && !done.has(j)) { first = j; break; }
              if (first === i) { done.add(i); progress = true; break; }
            }
          }
          if (done.size === cells.length) return '';
          if (!progress) break;
        }
        return 'stuck with ' + (cells.length - done.size) + ' fields unprinted';
      })()
    `);
    assert.equal(bad, '', `level ${n}: ${bad}`);
  }
});

test('fuzz: no field is ever finished or inked with a colour it did not owe', () => {
  ev('loadLevel(0)');
  const fail = ev(`
    (() => {
      const inF = c => frontierColors().has(c);
      for (let n = 0; n < 1200 && phase === 'play'; n++) {
        if (flying.length < MAX_FLY) {
          const p = parked.findIndex(Boolean);
          if (p >= 0 && inF(parked[p].color)) relaunchParked(p);
          else for (let l = 0; l < 3 && flying.length < MAX_FLY; l++)
            if (lanes[l].length && inF(lanes[l][0].color)) launchFromLane(l);
        }
        advance(0.05);
        let count = 0;
        for (let i = 0; i < G * G; i++) {
          const inked = gotA[i] || gotB[i];
          if (inked && needA[i] < 0) return 'inked an empty field ' + i;
          if (gotB[i] && needB[i] < 0) return 'got a second colour on a single field';
          if (paint[i] && !(gotA[i] && (needB[i] < 0 || gotB[i]))) return 'finished too early';
          if (paint[i]) count++;
        }
        if (count !== paintedCount) return 'paintedCount desync';
      }
      return '';
    })()
  `);
  assert.equal(fail, '', fail || 'ok');
});

test('cycling a lane brings the next drone forward without spending anything', () => {
  ev(`phase = 'play'; lanes = [[{ color: 0, mag: 5 }, { color: 1, mag: 6 }, { color: 2, mag: 7 }], [{ color: 3, mag: 4 }], []];`);
  assert.equal(ev('cycleLane(0)'), true);
  assert.deepEqual(Array.from(ev('lanes[0].map(d => d.color)')), [1, 2, 0], 'front moved to the back');
  assert.equal(ev('cycleLane(1)'), false, 'a single-drone lane cannot cycle');
  assert.equal(ev('cycleLane(2)'), false, 'an empty lane cannot cycle');
});

test('each level has a valid send order that spends exactly its magazines', () => {
  for (let n = 0; n < ev('LEVELS.length'); n++) {
    ev(`loadLevel(${n})`);
    const fail = ev(`
      (() => {
        const left = new Array(KEYS.length).fill(0);
        for (const d of lanes.flat()) left[d.color] += d.mag;
        for (let pass = 0; pass <= G * G * 2; pass++) {
          if (paintedCount === totalTargets) return '';
          const owed = frontierColors();
          let c = -1;
          for (const col of owed) if (left[col] > 0) { c = col; break; }
          if (c < 0) return 'a frontier colour has no shots left';
          for (let k = 0; k < NBINS; k++) {
            const ray = RAYS[k];
            let i = -1;
            for (const j of ray) if (needA[j] >= 0 && !paint[j]) { i = j; break; }
            if (i < 0) continue;
            if ((needA[i] === c && !gotA[i]) || (needB[i] === c && !gotB[i])) { applyShot(i, c); left[c]--; }
          }
        }
        return 'ran out of passes';
      })()
    `);
    assert.equal(fail, '', `level ${n}: ${fail}`);
  }
});

test('drawing a frame never throws', () => {
  ev('loadLevel(1)');
  assert.doesNotThrow(() => ev('drawScene(0.016)'));
  assert.doesNotThrow(() => ev('drawDrone(g2, 0, 0, 10, 0, true, .5, 16)'), 'full tanks render in flight');
  assert.doesNotThrow(() => ev('drawDrone(g2, 0, 0, 10, 0, false, .5, 3)'), 'low tanks render while parked');
});
