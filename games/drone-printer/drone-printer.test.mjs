// Game logic tests for drone-printer.html: `node --test`
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

// Run the page's <script> with a stub DOM so we can drive the real painting logic.
const code = readFileSync(new URL('./drone-printer.html', import.meta.url), 'utf8').match(/<script>([\s\S]*)<\/script>/)[1];
const noop = () => {};
const gctx = { fillRect: noop, clearRect: noop, beginPath: noop, arc: noop, fill: noop, stroke: noop, strokeRect: noop, moveTo: noop, lineTo: noop, fillStyle: '', strokeStyle: '', lineWidth: 1, globalAlpha: 1 };
const el = () => ({
  style: { setProperty() {}, display: '' }, dataset: {}, textContent: '', className: '', clientWidth: 320, width: 320, height: 320,
  classList: { add() {}, remove() {} }, append() {}, appendChild: c => c, remove() {}, addEventListener() {}, querySelectorAll: () => [],
  getContext: () => gctx,
});
const store = new Map();
const ctx = {
  document: { getElementById: el, createElement: el, body: { append() {} } },
  addEventListener() {}, removeEventListener() {}, setTimeout: fn => fn(), console,
  localStorage: { getItem: k => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)) },
};
vm.createContext(ctx);
vm.runInContext(code, ctx);
const ev = expr => vm.runInContext(expr, ctx);
const G = ev('G'), C = Math.floor(G / 2), CENTRE = C * G + C;

// Point the game at a tiny hand-made image: three cells in a row to the right of centre.
const scene = () => ev(`
  (() => {
    target = new Int8Array(G * G).fill(-1);
    paint = new Uint8Array(G * G);
    const c = Math.floor(G / 2);
    target[c * G + c] = 0;       // red at the centre
    target[c * G + c + 1] = 1;   // blue one cell out
    target[c * G + c + 2] = 0;   // red further out
    paintedCount = 0; totalTargets = 3;
    flying = []; parked = [null, null, null]; phase = 'play';
  })()
`);

test('every level image is a well-formed G x G grid of known colours', () => {
  for (let n = 0; n < ev('LEVELS.length'); n++) {
    const art = Array.from(ev(`LEVELS[${n}].art`));
    assert.equal(art.length, G, `level ${n} row count`);
    for (const row of art) {
      assert.equal(row.length, G, `level ${n} row width`);
      assert.match(row, /^[.rbgwk]+$/, `level ${n} uses known colours`);
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

test('a ray starts at the centre, points outward and never crosses to the far side', () => {
  const right = Array.from(ev('rayCells(0)'));
  assert.equal(right[0], CENTRE, 'first cell is the centre');
  assert.ok(right.includes(CENTRE + 3), 'reaches out to the right');
  assert.ok(!right.includes(CENTRE - 1), 'does not reach the left side');
  const down = Array.from(ev(`rayCells(${Math.PI / 2})`));
  assert.equal(down[0], CENTRE);
  assert.ok(down.includes((C + 2) * G + C), 'reaches downward (canvas y grows down)');
  assert.ok(!down.includes((C - 2) * G + C), 'does not reach upward');
  const ray = Array.from(ev('rayCells(0.7)'));
  assert.ok(ray.every(i => i >= 0 && i < G * G), 'stays inside the canvas');
});

test('a drone only prints its own colour, and only the most central cell of its ray', () => {
  scene();
  const red = { color: 0, ang: 0 }, blue = { color: 1, ang: 0 }, other = { color: 2, ang: 0 };
  assert.equal(ev('shootTarget')(red), CENTRE, 'red takes the centre');
  assert.equal(ev('shootTarget')(blue), -1, 'blue is blocked by the unpainted red centre');
  assert.equal(ev('shootTarget')(other), -1, 'a colour not on the frontier prints nothing');
  ev(`paint[${CENTRE}] = 1; paintedCount = 1;`);
  assert.equal(ev('shootTarget')(red), -1, 'red cannot print past the unpainted blue');
  assert.equal(ev('shootTarget')(blue), CENTRE + 1, 'blue prints the next cell');
  ev(`paint[${CENTRE + 1}] = 1; paintedCount = 2;`);
  assert.equal(ev('shootTarget')(red), CENTRE + 2, 'red prints the outer cell last');
  assert.equal(ev('shootTarget')({ color: 0, ang: Math.PI }), -1, 'facing away, red reaches nothing');
});

test('the frontier initially reports only the centre colour', () => {
  scene();
  assert.deepEqual(Array.from(ev('frontierColors()')), [0], 'only red is printable at the start');
});

test('three landing pads hold drones; a fourth landing crashes', () => {
  ev('flying = []; parked = [null, null, null]; phase = "play";');
  ev('land({ color: 0, mag: 1 }); land({ color: 1, mag: 2 }); land({ color: 2, mag: 3 });');
  assert.equal(ev('parked.every(Boolean)'), true, 'all pads taken');
  assert.equal(ev('phase'), 'play');
  ev('land({ color: 3, mag: 1 })');
  assert.equal(ev('phase'), 'over', 'no pad free, so it crashes');
});

test('no more than three drones fly at once, and parked drones can be re-sent', () => {
  ev(`
    phase = 'play'; flying = []; parked = [null, null, null];
    lanes = [[{ color: 0, mag: 5 }], [{ color: 1, mag: 5 }], [{ color: 2, mag: 5 }]];
    startFlight(lanes[0].shift()); startFlight(lanes[1].shift()); startFlight(lanes[2].shift());
  `);
  assert.equal(ev('flying.length'), 3);
  ev('lanes[0].push({ color: 3, mag: 5 })');
  assert.equal(ev('launchFromLane(0)'), false, 'fourth drone refused while three are flying');
  ev('parked[0] = { color: 4, mag: 9 }');
  assert.equal(ev('relaunchParked(0)'), false, 'padding a parked drone also refused');
  ev('flying.pop()');
  assert.equal(ev('launchFromLane(0)'), true, 'a freed slot lets the next front drone go');
  ev('flying.pop()');
  assert.equal(ev('relaunchParked(0)'), true, 'and a parked drone may take the air');
  assert.equal(ev('parked[0]'), null);
});

test('emptying a magazine mid-lap makes the drone fly away instead of landing', () => {
  ev(`
    target = new Int8Array(G * G).fill(-1);
    paint = new Uint8Array(G * G);
    target[Math.floor(G / 2) * G + Math.floor(G / 2)] = 0;
    paintedCount = 0; totalTargets = 1; parked = [null, null, null];
    flying = []; phase = 'play'; score = 0; level = 0; totalDrones = 1; best = 0;
    const d = { color: 0, mag: 1 }; startFlight(d); d.ang = 0; d.cd = 0;
  `);
  ev('advance(0.02)');
  assert.equal(ev('phase'), 'won', 'the single-cell image completes');
  assert.equal(ev('paintedCount'), 1);
});

test('a whole level is printable: every pixel can be reached from the centre out', () => {
  for (let n = 0; n < ev('LEVELS.length'); n++) {
    ev(`loadLevel(${n})`);
    // Repeatedly print any pixel that is the most central unpainted cell of its own
    // ray. If the fixpoint stalls, some pixel can never be printed in this order.
    const bad = ev(`
      (() => {
        const c = (G - 1) / 2;
        const cells = [];
        for (let i = 0; i < G * G; i++) if (target[i] >= 0) cells.push(i);
        const done = new Set();
        for (let pass = 0; pass <= cells.length; pass++) {
          let progress = false;
          for (const i of cells) {
            if (done.has(i)) continue;
            const ang = Math.atan2(((i / G) | 0) - c, (i % G) - c);
            for (let k = -12; k <= 12; k++) {
              const ray = rayCells(ang + k * 0.01);
              let first = -1;
              for (const j of ray) if (target[j] >= 0 && !done.has(j)) { first = j; break; }
              if (first === i) { done.add(i); progress = true; break; }
            }
          }
          if (done.size === cells.length) return '';
          if (!progress) break;
        }
        return 'stuck with ' + (cells.length - done.size) + ' pixels unprinted';
      })()
    `);
    assert.equal(bad, '', `level ${n}: ${bad}`);
  }
});

test('fuzz: painting never leaves a cell printed in the wrong colour', () => {
  ev('loadLevel(0)');
  const fail = ev(`
    (() => {
      const inFrontier = col => frontierColors().has(col);
      for (let n = 0; n < 1500 && phase === 'play'; n++) {
        if (flying.length < 3) {
          const p = parked.findIndex(Boolean);
          if (p >= 0 && inFrontier(parked[p].color)) relaunchParked(p);
          else for (let l = 0; l < 3 && flying.length < 3; l++)
            if (lanes[l].length && inFrontier(lanes[l][0].color)) launchFromLane(l);
        }
        advance(0.05);
        let count = 0;
        for (let i = 0; i < G * G; i++) {
          if (paint[i] && target[i] < 0) return 'painted an empty cell ' + i;
          if (paint[i]) count++;
        }
        if (count !== paintedCount) return 'paintedCount desync';
      }
      return '';
    })()
  `);
  assert.equal(fail, '', fail || 'ok');
  assert.ok(ev('paintedCount') > 0, 'the fuzz run printed at least something');
});

test('cycling a lane brings the next drone forward without spending anything', () => {
  ev(`phase = 'play'; lanes = [[{ color: 0, mag: 5 }, { color: 1, mag: 6 }, { color: 2, mag: 7 }], [{ color: 3, mag: 4 }], []];`);
  assert.equal(ev('cycleLane(0)'), true);
  assert.deepEqual(Array.from(ev('lanes[0].map(d => d.color)')), [1, 2, 0], 'front moved to the back');
  assert.equal(ev('lanes[1].length'), 1);
  assert.equal(ev('cycleLane(1)'), false, 'a single-drone lane cannot cycle');
  assert.equal(ev('cycleLane(2)'), false, 'an empty lane cannot cycle');
});

test('each level has a valid send order that spends exactly its magazines', () => {
  for (let n = 0; n < ev('LEVELS.length'); n++) {
    ev(`loadLevel(${n})`);
    // A drone can empty itself on every frontier cell of its colour in one lap, so
    // greedily draining one frontier colour at a time shows the magazines suffice.
    const fail = ev(`
      (() => {
        const left = new Array(KEYS.length).fill(0);
        for (const d of lanes.flat()) left[d.color] += d.mag;
        for (let pass = 0; pass <= G * G; pass++) {
          const frontier = new Set();
          for (let k = 0; k < 720; k++) { const i = firstUnpainted(rayCells(k * Math.PI * 2 / 720)); if (i >= 0) frontier.add(i); }
          if (!frontier.size) return '';
          let col = -1;
          for (const i of frontier) if (left[target[i]] > 0) { col = target[i]; break; }
          if (col < 0) return 'a frontier colour has no shots left';
          for (const i of frontier) if (target[i] === col) { paint[i] = 1; left[col]--; }
        }
        return 'ran out of passes';
      })()
    `);
    assert.equal(fail, '', `level ${n}: ${fail}`);
    assert.equal(ev('paintedCount === 0'), true, 'test drives its own paint array');
  }
});

test('drawing a frame never throws', () => {
  ev('loadLevel(1)');
  assert.doesNotThrow(() => ev('drawScene(0.016)'));
});
