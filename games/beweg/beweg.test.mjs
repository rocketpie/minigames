// Game logic tests for beweg.html: `node --test`
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

// Run the page's <script> with a stub DOM so we can drive the real rules and tap code.
const code = readFileSync(new URL('./beweg.html', import.meta.url), 'utf8')
  .match(/<script>([\s\S]*)<\/script>/)[1];
const el = () => ({
  style: { setProperty() {} }, dataset: {}, textContent: '', innerHTML: '', disabled: false, hidden: false,
  className: '', title: '',
  classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
  append() {}, appendChild: c => c, remove() {}, focus() {}, querySelectorAll: () => [],
  querySelector: () => null, addEventListener() {}, closest: () => null,
  getBoundingClientRect: () => ({ width: 800, height: 800, left: 0, top: 0 }),
});
const nodes = new Map();
const store = new Map();
const ctx = {
  document: {
    getElementById: id => {
      if (!nodes.has(id)) nodes.set(id, el());
      return nodes.get(id);
    },
    createElement: el,
    activeElement: null,
  },
  addEventListener() {}, requestAnimationFrame: fn => fn(), setTimeout: fn => fn(), clearTimeout() {},
  innerWidth: 900, innerHeight: 900, console,
  URL,
  URLSearchParams,
  confirm: () => true,
  location: {
    href: 'http://localhost:8000/beweg/beweg.html',
    origin: 'http://localhost:8000',
    pathname: '/beweg/beweg.html',
    hostname: 'localhost',
    protocol: 'http:',
    host: 'localhost:8000',
    search: '',
    hash: '',
  },
  localStorage: {
    getItem: k => store.get(k) ?? null,
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: k => store.delete(k),
  },
};
vm.createContext(ctx);
vm.runInContext(code, ctx);

const run = expression => vm.runInContext(expression, ctx);
const js = value => JSON.parse(JSON.stringify(value));

const at = name => (8 - Number(name[1])) * 8 + 'abcdefgh'.indexOf(name[0]);
const empty = () => Array(64).fill(null);
const put = (board, square, piece) => { board[at(square)] = piece; return board; };

const apply = move => js(run(`applyMove(game, ${JSON.stringify(move)})`));

function play(moves) {
  for (const move of moves) {
    const result = apply(move);
    assert.equal(result.ok, true, `${JSON.stringify(move)}: ${result.reason}`);
    run(`game = ${JSON.stringify(result.state)}`);
  }
}

function setPosition({ board, turn = 'w', castle = {}, ep = null, half = 0, full = 1 }) {
  const rights = { K: false, Q: false, k: false, q: false, ...castle };
  run(`game = ${JSON.stringify({
    board, turn, castle: rights, ep, half, full,
    status: 'playing', winner: null, reason: '', last: null, captured: [], scars: [],
  })}; sel = -1; targets = []; promo = null;`);
}

test('initial position: 32 figures, teleporters on the outer files and trebuchets beside them, Gold starts', () => {
  run('game = newChess()');
  assert.equal(run('game.board.filter(Boolean).length'), 32);
  assert.equal(run('game.turn'), 'w');
  for (const square of ['a2', 'h2', 'a7', 'h7']) {
    assert.equal(run(`game.board[${at(square)}]`), square[1] === '2' ? 'T' : 't');
  }
  for (const square of ['b2', 'g2', 'b7', 'g7']) {
    assert.equal(run(`game.board[${at(square)}]`), square[1] === '2' ? 'C' : 'c');
  }
  assert.equal(run('allLegalMoves(game).length'), 104);
});

test('double pawn push opens en passant for exactly one move', () => {
  run('game = newChess()');
  play([
    { from: at('e2'), to: at('e4') },
    { from: at('b8'), to: at('c6') },
    { from: at('e4'), to: at('e5') },
    { from: at('d7'), to: at('d5') },
  ]);
  assert.equal(run('game.ep'), at('d6'));
  const options = js(run(`legalMoves(game, ${at('e5')})`));
  assert.ok(options.some(m => m.to === at('d6') && m.ep));

  const result = apply({ from: at('e5'), to: at('d6') });
  assert.equal(result.ok, true);
  assert.equal(result.state.board[at('d6')], 'P');
  assert.equal(result.state.board[at('d5')], null);
  assert.equal(result.state.ep, null);
  assert.equal(result.state.last.captureAt, at('d5'));
  assert.equal(result.state.last.attack, 'beam');
  assert.deepEqual(result.state.scars, [{ sq: at('d5'), kind: 'burn' }]);
});

test('a pawn may advance one or two squares from any rank', () => {
  const board = empty();
  put(board, 'e1', 'K'); put(board, 'e8', 'k'); put(board, 'e3', 'P');
  setPosition({ board });

  const options = js(run(`legalMoves(game, ${at('e3')})`));
  assert.ok(options.some(m => m.to === at('e4')));
  assert.ok(options.some(m => m.to === at('e5')));
});

test('a pawn may not run two squares through a blocking figure', () => {
  const board = empty();
  put(board, 'e1', 'K'); put(board, 'e8', 'k'); put(board, 'e3', 'P'); put(board, 'e4', 'n');
  setPosition({ board });

  assert.deepEqual(js(run(`legalMoves(game, ${at('e3')}).map(m => m.to)`)), []);
});

test('a pawn captures two squares diagonally when the path is clear', () => {
  const board = empty();
  put(board, 'e1', 'K'); put(board, 'e8', 'k'); put(board, 'e3', 'P'); put(board, 'g5', 'r');
  setPosition({ board });

  const options = js(run(`legalMoves(game, ${at('e3')})`));
  assert.ok(options.some(m => m.to === at('g5')));

  const result = apply({ from: at('e3'), to: at('g5') });
  assert.equal(result.ok, true);
  assert.equal(result.state.board[at('g5')], 'P');
  assert.equal(result.state.board[at('e3')], null);
  assert.equal(result.state.last.attack, 'beam');
  assert.deepEqual(result.state.scars, [{ sq: at('g5'), kind: 'burn' }]);
});

test('a pawn may not capture two squares diagonally through a figure', () => {
  const board = empty();
  put(board, 'e1', 'K'); put(board, 'e8', 'k'); put(board, 'e3', 'P');
  put(board, 'f4', 'P'); put(board, 'g5', 'r');
  setPosition({ board });

  assert.ok(!js(run(`legalMoves(game, ${at('e3')})`)).some(m => m.to === at('g5')));
});

test('a two-square pawn capture gives check', () => {
  const board = empty();
  put(board, 'c1', 'K'); put(board, 'e8', 'k'); put(board, 'e3', 'p');
  setPosition({ board, turn: 'w' });
  assert.equal(run(`inCheck(game, 'w')`), true);

  const blocked = board.slice();
  put(blocked, 'd2', 'B');
  setPosition({ board: blocked, turn: 'w' });
  assert.equal(run(`inCheck(game, 'w')`), false);
});

test('a pawn may promote with a two-square advance', () => {
  const board = empty();
  put(board, 'e1', 'K'); put(board, 'e8', 'k'); put(board, 'a6', 'P');
  setPosition({ board });

  const promos = js(run(`legalMoves(game, ${at('a6')})`)).filter(m => m.promo);
  assert.equal(promos.length, 5);
  assert.ok(promos.every(m => m.to === at('a8')));

  const result = apply({ from: at('a6'), to: at('a8'), promo: 'T' });
  assert.equal(result.ok, true);
  assert.equal(result.state.board[at('a8')], 'T');
});

test('castling moves king and rook, and rights disappear', () => {
  const board = empty();
  put(board, 'e1', 'K'); put(board, 'h1', 'R');
  put(board, 'e8', 'k'); put(board, 'a8', 'r');
  setPosition({ board, castle: { K: true, Q: true } });

  const options = js(run(`legalMoves(game, ${at('e1')})`));
  assert.ok(options.some(m => m.to === at('g1') && m.castle === 'K'));

  const result = apply({ from: at('e1'), to: at('g1') });
  assert.equal(result.ok, true);
  assert.equal(result.state.board[at('g1')], 'K');
  assert.equal(result.state.board[at('f1')], 'R');
  assert.equal(result.state.board[at('h1')], null);
  assert.equal(result.state.castle.K, false);
  assert.equal(result.state.castle.Q, false);
});

test('castling is illegal through an attacked square', () => {
  const board = empty();
  put(board, 'e1', 'K'); put(board, 'h1', 'R');
  put(board, 'e8', 'k'); put(board, 'f8', 'r');
  setPosition({ board, castle: { K: true } });

  const options = js(run(`legalMoves(game, ${at('e1')})`));
  assert.ok(!options.some(m => m.to === at('g1')));
});

test('a king or rook move drops the matching castling right', () => {
  const kingBoard = empty();
  put(kingBoard, 'e1', 'K'); put(kingBoard, 'h1', 'R'); put(kingBoard, 'e8', 'k');
  setPosition({ board: kingBoard, castle: { K: true, Q: true } });
  const kingMove = apply({ from: at('e1'), to: at('e2') });
  assert.equal(kingMove.ok, true);
  assert.equal(kingMove.state.castle.K, false);
  assert.equal(kingMove.state.castle.Q, false);

  const rookBoard = empty();
  put(rookBoard, 'e1', 'K'); put(rookBoard, 'h1', 'R'); put(rookBoard, 'e8', 'k');
  setPosition({ board: rookBoard, castle: { K: true, Q: true } });
  const rookMove = apply({ from: at('h1'), to: at('h2') });
  assert.equal(rookMove.ok, true);
  assert.equal(rookMove.state.castle.K, false);
  assert.equal(rookMove.state.castle.Q, true);
});

test('a captured rook removes the opponent castling right', () => {
  const board = empty();
  put(board, 'e1', 'K'); put(board, 'a1', 'R');
  put(board, 'e8', 'k'); put(board, 'a8', 'r');
  setPosition({ board, castle: { Q: true, q: true } });

  const result = apply({ from: at('a1'), to: at('a8') });
  assert.equal(result.ok, true);
  assert.equal(result.state.castle.q, false);
  assert.equal(result.state.castle.Q, false);
});

test('promotion needs a choice and allows underpromotion', () => {
  const board = empty();
  put(board, 'a7', 'P'); put(board, 'e1', 'K'); put(board, 'e8', 'k');
  setPosition({ board });

  const options = js(run(`legalMoves(game, ${at('a7')})`));
  assert.equal(options.filter(m => m.promo).length, 5);
  assert.equal(apply({ from: at('a7'), to: at('a8') }).ok, false);

  const queen = apply({ from: at('a7'), to: at('a8'), promo: 'Q' });
  assert.equal(queen.ok, true);
  assert.equal(queen.state.board[at('a8')], 'Q');
  assert.deepEqual(queen.state.captured, []);
  assert.deepEqual(queen.state.scars, []);

  setPosition({ board });
  const knight = apply({ from: at('a7'), to: at('a8'), promo: 'N' });
  assert.equal(knight.ok, true);
  assert.equal(knight.state.board[at('a8')], 'N');

  setPosition({ board });
  const teleporter = apply({ from: at('a7'), to: at('a8'), promo: 'T' });
  assert.equal(teleporter.ok, true);
  assert.equal(teleporter.state.board[at('a8')], 'T');
});

test('a teleporter can block a queen check', () => {
  const board = empty();
  put(board, 'e1', 'K'); put(board, 'e8', 'k'); put(board, 'a2', 'T'); put(board, 'h4', 'q');
  setPosition({ board });
  assert.equal(run(`inCheck(game, 'w')`), true);

  const options = js(run(`legalMoves(game, ${at('a2')})`));
  assert.ok(options.some(m => m.to === at('g3')));
  play([{ from: at('a2'), to: at('g3') }]);
  assert.equal(run(`inCheck(game, 'w')`), false);
});

test('a back-rank mate is checkmate', () => {
  const board = empty();
  put(board, 'h1', 'K'); put(board, 'g2', 'P'); put(board, 'h2', 'P');
  put(board, 'a1', 'r'); put(board, 'h8', 'k');
  setPosition({ board });

  assert.equal(run(`inCheck(game, 'w')`), true);
  assert.equal(run('allLegalMoves(game).length'), 0);
  const status = js(run('evaluateStatus(game)'));
  assert.equal(status.status, 'checkmate');
  assert.equal(status.winner, 'b');
});

test('stalemate is a draw', () => {
  const board = empty();
  put(board, 'a8', 'k'); put(board, 'c6', 'K'); put(board, 'b6', 'Q');
  setPosition({ board, turn: 'b' });

  assert.equal(run('allLegalMoves(game).length'), 0);
  assert.equal(run(`inCheck(game, 'b')`), false);
  const status = js(run('evaluateStatus(game)'));
  assert.equal(status.status, 'stalemate');
  assert.equal(status.winner, null);
});

test('fifty-move rule and insufficient material are draws', () => {
  const board = empty();
  put(board, 'e1', 'K'); put(board, 'e8', 'k'); put(board, 'h1', 'R');
  setPosition({ board, half: 100 });
  assert.deepEqual(js(run('evaluateStatus(game)')), { status: 'draw', winner: null, reason: 'fifty' });

  const bare = empty();
  put(bare, 'e1', 'K'); put(bare, 'e8', 'k');
  assert.equal(run(`insufficientMaterial(${JSON.stringify(bare)})`), true);
  assert.equal(run(`insufficientMaterial(${JSON.stringify(put(bare.slice(), 'c1', 'B'))})`), true);
  assert.equal(run(`insufficientMaterial(${JSON.stringify(put(bare.slice(), 'c1', 'N'))})`), true);

  const sameBishops = put(put(bare.slice(), 'c1', 'B'), 'f8', 'b');
  assert.equal(run(`insufficientMaterial(${JSON.stringify(sameBishops)})`), true);
  const oppositeBishops = put(put(bare.slice(), 'c1', 'B'), 'c8', 'b');
  assert.equal(run(`insufficientMaterial(${JSON.stringify(oppositeBishops)})`), false);
  const rook = put(bare.slice(), 'h1', 'R');
  assert.equal(run(`insufficientMaterial(${JSON.stringify(rook)})`), false);
});

test('a teleporter teleports to any empty square without a capture', () => {
  const board = empty();
  put(board, 'e1', 'K'); put(board, 'e8', 'k'); put(board, 'a2', 'T');
  setPosition({ board });

  const options = js(run(`legalMoves(game, ${at('a2')})`));
  assert.ok(options.some(m => m.to === at('h6') && !m.suicide));

  const result = apply({ from: at('a2'), to: at('h6') });
  assert.equal(result.ok, true);
  assert.equal(result.state.board[at('h6')], 'T');
  assert.equal(result.state.board[at('a2')], null);
  assert.equal(result.state.last.warp, true);
  assert.equal(result.state.last.suicide, undefined);
  assert.deepEqual(result.state.scars, []);
  assert.deepEqual(result.state.captured, []);
});

test('a teleporter may not attack the rival king or queen, but any other figure including trebuchets and teleporters', () => {
  const board = empty();
  put(board, 'e1', 'K'); put(board, 'e8', 'k'); put(board, 'a2', 'T');
  put(board, 'd5', 'q'); put(board, 'h6', 'r'); put(board, 'f5', 't'); put(board, 'c4', 'c');
  setPosition({ board });

  const options = js(run(`legalMoves(game, ${at('a2')})`));
  assert.ok(!options.some(m => m.to === at('d5')));
  assert.ok(!options.some(m => m.to === at('e8')));
  assert.ok(options.some(m => m.to === at('f5') && m.suicide));
  assert.ok(options.some(m => m.to === at('c4') && m.suicide));
  assert.ok(options.some(m => m.to === at('h6') && m.suicide));
});

test('a teleporter capture explodes both figures and leaves a crater', () => {
  const board = empty();
  put(board, 'e1', 'K'); put(board, 'e8', 'k'); put(board, 'a2', 'T'); put(board, 'h6', 'r');
  setPosition({ board });

  const result = apply({ from: at('a2'), to: at('h6') });
  assert.equal(result.ok, true);
  assert.equal(result.state.board[at('a2')], null);
  assert.equal(result.state.board[at('h6')], null);
  assert.equal(result.state.last.attack, 'warp');
  assert.equal(result.state.last.suicide, true);
  assert.equal(result.state.last.captured, 'r');
  assert.deepEqual(result.state.captured, ['r', 'T']);
  assert.deepEqual(result.state.scars, [{ sq: at('h6'), kind: 'crater' }]);
  assert.deepEqual(js(run(`spoils({ captured: ${JSON.stringify(result.state.captured)} }, 'w')`)), ['T']);
});

test('a teleporter never gives check, even next to the rival king', () => {
  const board = empty();
  put(board, 'e1', 'K'); put(board, 'e8', 'k'); put(board, 'd7', 'T');
  setPosition({ board, turn: 'b' });

  assert.equal(run(`inCheck(game, 'b')`), false);
  assert.ok(js(run(`legalMoves(game, ${at('e8')})`)).some(m => m.to === at('d7')));
});

test('a teleporter may not teleport away from a pinned square', () => {
  const board = empty();
  put(board, 'e1', 'K'); put(board, 'e2', 'T'); put(board, 'e8', 'r'); put(board, 'h8', 'k');
  setPosition({ board });

  const options = js(run(`legalMoves(game, ${at('e2')})`));
  assert.ok(!options.some(m => m.to === at('a2')));
  assert.ok(options.some(m => m.to === at('e3')));
});

test('a lone teleporter cannot force mate', () => {
  const bare = empty();
  put(bare, 'e1', 'K'); put(bare, 'e8', 'k');
  assert.equal(run(`insufficientMaterial(${JSON.stringify(put(bare.slice(), 'a1', 'T'))})`), true);
  assert.equal(run(`insufficientMaterial(${JSON.stringify(put(put(bare.slice(), 'a1', 'T'), 'h8', 't'))})`), true);
});

test('a trebuchet cannot march and shoots only the first rival in line', () => {
  const board = empty();
  put(board, 'e1', 'K'); put(board, 'e8', 'k');
  put(board, 'd4', 'C'); put(board, 'd7', 'r'); put(board, 'f4', 'n');
  setPosition({ board });

  const options = js(run(`legalMoves(game, ${at('d4')})`));
  assert.deepEqual(options.map(m => m.to).sort((a, b) => a - b),
    [at('d7'), at('f4')].sort((a, b) => a - b));
  assert.ok(options.every(m => m.shot));
  assert.equal(apply({ from: at('d4'), to: at('d5') }).ok, false);
});

test('a trebuchet shot destroys the target and leaves the trebuchet in place', () => {
  const board = empty();
  put(board, 'e1', 'K'); put(board, 'e8', 'k');
  put(board, 'a1', 'C'); put(board, 'a5', 'r');
  setPosition({ board });

  const result = apply({ from: at('a1'), to: at('a5') });
  assert.equal(result.ok, true);
  assert.equal(result.state.board[at('a1')], 'C');
  assert.equal(result.state.board[at('a5')], null);
  assert.equal(result.state.last.from, at('a1'));
  assert.equal(result.state.last.to, at('a5'));
  assert.equal(result.state.last.shot, true);
  assert.equal(result.state.last.attack, 'hurl');
  assert.deepEqual(result.state.captured, ['r']);
  assert.deepEqual(result.state.scars, [{ sq: at('a5'), kind: 'crater' }]);
});

test('a trebuchet shot plays the boulder spell and settles', () => {
  const realTimer = ctx.setTimeout;
  ctx.timers = [];
  ctx.setTimeout = (fn, ms) => { ctx.timers.push({ fn, ms }); };
  try {
    run('MP.active = false; MP.host = false; game = newChess(); sel = -1; targets = [];');
    const board = empty();
    put(board, 'e1', 'K'); put(board, 'e8', 'k');
    put(board, 'a1', 'C'); put(board, 'a5', 'r');
    setPosition({ board });

    run(`onSquare(${at('a1')})`);
    run(`onSquare(${at('a5')})`);

    const during = run(`$('board').innerHTML`);
    assert.match(during, new RegExp(`data-sq="${at('a1')}" aria-label="[^"]*Gold trebuchet"`));
    assert.match(during, new RegExp(`data-sq="${at('a5')}" aria-label="[^"]*Emerald rook"`));
    assert.equal(run('animating'), true);

    run(`
      while (timers.length) {
        timers.sort((a, b) => a.ms - b.ms);
        timers.shift().fn();
      }
    `);

    const after = run(`$('board').innerHTML`);
    assert.match(after, new RegExp(`data-sq="${at('a1')}" aria-label="[^"]*Gold trebuchet"`));
    assert.match(after, new RegExp(`data-sq="${at('a5')}" aria-label="[^"]*empty"`));
    assert.match(after, /class="scar crater"/);
    assert.equal(run('animating'), false);
    assert.equal(run('view'), null);
  } finally {
    ctx.setTimeout = realTimer;
    delete ctx.timers;
  }
});

test('a trebuchet cannot shoot past the first figure', () => {
  const board = empty();
  put(board, 'e1', 'K'); put(board, 'e8', 'k');
  put(board, 'a1', 'C'); put(board, 'a3', 'p'); put(board, 'a5', 'r');
  setPosition({ board });

  const options = js(run(`legalMoves(game, ${at('a1')})`));
  assert.ok(options.some(m => m.to === at('a3') && m.shot));
  assert.ok(!options.some(m => m.to === at('a5')));
});

test('a trebuchet shoots up to four squares, straight or diagonal', () => {
  const straight = empty();
  put(straight, 'e1', 'K'); put(straight, 'e8', 'k'); put(straight, 'a1', 'C'); put(straight, 'a5', 'r');
  setPosition({ board: straight });
  assert.ok(js(run(`legalMoves(game, ${at('a1')})`)).some(m => m.to === at('a5') && m.shot));

  const tooFar = empty();
  put(tooFar, 'e1', 'K'); put(tooFar, 'e8', 'k'); put(tooFar, 'a1', 'C'); put(tooFar, 'a6', 'r');
  setPosition({ board: tooFar });
  assert.deepEqual(js(run(`legalMoves(game, ${at('a1')})`)), []);

  const diagonal = empty();
  put(diagonal, 'e1', 'K'); put(diagonal, 'e8', 'k'); put(diagonal, 'a1', 'C'); put(diagonal, 'd4', 'r');
  setPosition({ board: diagonal });
  assert.ok(js(run(`legalMoves(game, ${at('a1')})`)).some(m => m.to === at('d4') && m.shot));

  const diagonalEdge = empty();
  put(diagonalEdge, 'e1', 'K'); put(diagonalEdge, 'e8', 'k'); put(diagonalEdge, 'a1', 'C'); put(diagonalEdge, 'e5', 'r');
  setPosition({ board: diagonalEdge });
  assert.ok(js(run(`legalMoves(game, ${at('a1')})`)).some(m => m.to === at('e5') && m.shot));

  const diagonalTooFar = empty();
  put(diagonalTooFar, 'e1', 'K'); put(diagonalTooFar, 'e8', 'k'); put(diagonalTooFar, 'a1', 'C'); put(diagonalTooFar, 'f6', 'r');
  setPosition({ board: diagonalTooFar });
  assert.deepEqual(js(run(`legalMoves(game, ${at('a1')})`)), []);
});

test('a trebuchet gives check down a clear line', () => {
  const board = empty();
  put(board, 'd1', 'K'); put(board, 'h8', 'k'); put(board, 'd5', 'c');
  setPosition({ board, turn: 'w' });
  assert.equal(run(`inCheck(game, 'w')`), true);

  const blocked = board.slice();
  put(blocked, 'd3', 'P');
  setPosition({ board: blocked, turn: 'w' });
  assert.equal(run(`inCheck(game, 'w')`), false);

  const tooFar = empty();
  put(tooFar, 'd1', 'K'); put(tooFar, 'h8', 'k'); put(tooFar, 'd6', 'c');
  setPosition({ board: tooFar, turn: 'w' });
  assert.equal(run(`inCheck(game, 'w')`), false);
});

test('a trebuchet is mating material', () => {
  const board = empty();
  put(board, 'b3', 'K'); put(board, 'e1', 'C'); put(board, 'a1', 'k');
  setPosition({ board, turn: 'b' });
  assert.equal(run(`inCheck(game, 'b')`), true);
  const status = js(run('evaluateStatus(game)'));
  assert.equal(status.status, 'checkmate');
  assert.equal(status.winner, 'w');
});

test('bishops ride a luminescent cloud and trebuchets are cranes', () => {
  assert.match(run("figHTML('B')"), /class="piece w type-b/);
  assert.match(run("figHTML('b')"), /class="piece b type-b/);
  assert.match(run("figHTML('C')"), /class="piece w type-c/);
  assert.match(run("figHTML('c')"), /class="piece b type-c/);
});

test('the board crack turns half transparent after twenty seconds', () => {
  const realTimer = ctx.setTimeout;
  const timers = [];
  ctx.setTimeout = (fn, ms) => { timers.push({ fn, ms }); };
  const crack = ctx.document.getElementById('crack');
  const original = crack.classList;
  const classes = new Set();
  crack.classList = {
    add: (...names) => names.forEach(n => classes.add(n)),
    remove: (...names) => names.forEach(n => classes.delete(n)),
    contains: name => classes.has(name),
    toggle() {},
  };
  try {
    run('MP.active = false; MP.host = false; crackDone = false; crackPose = null; game = newChess();');
    run(`game.captured = Array(17).fill('p'); render()`);
    assert.ok(classes.has('cracking'));

    const fade = timers.find(t => t.ms === 20000);
    assert.ok(fade);
    assert.ok(!classes.has('faded'));

    fade.fn();
    assert.ok(classes.has('faded'));
  } finally {
    ctx.setTimeout = realTimer;
    crack.classList = original;
    run('game.captured = []; render();');
  }
});

test('checkmate fells the king and skips the popup', () => {
  const board = empty();
  put(board, 'h1', 'K'); put(board, 'g2', 'P'); put(board, 'h2', 'P');
  put(board, 'a1', 'r'); put(board, 'h8', 'k');
  setPosition({ board });
  run(`
    game.status = 'checkmate'; game.winner = 'b'; game.reason = 'checkmate';
    kingFireDone = false; resultDismissed = false; render();
  `);

  assert.equal(run(`$('result').hidden`), true);
  assert.equal(run('kingFireDone'), true);

  const html = run(`$('board').innerHTML`);
  const kingSquare = html.match(new RegExp(`data-sq="${at('h1')}"[\\s\\S]*?</button>`))[0];
  assert.match(kingSquare, /class="piece w type-k fallen/);
  assert.match(kingSquare, /class="king-fire"/);
  assert.match(kingSquare, /class="scar burn"/);
});

test('the board cracks after more than half the figures are defeated', () => {
  run('MP.active = false; MP.host = false; crackDone = false; crackPose = null; game = newChess(); $("crack").style.transform = ""');
  run(`game.captured = Array(16).fill('p'); render()`);
  assert.equal(run(`$('crack').hidden`), true);
  assert.equal(run('crackPose'), null);
  assert.equal(run(`$('crack').style.transform`), '');

  run(`game.captured = Array(17).fill('p'); render()`);
  assert.equal(run(`$('crack').hidden`), false);
  assert.equal(run('crackDone'), true);

  const pose = js(run('crackPose'));
  assert.ok(pose);
  assert.notEqual(pose.angle, 0);
  assert.match(run(`$('crack').style.transform`), /rotate\(/);
  assert.match(run(`$('crack').style.transform`), /translate\(/);

  run('newGame()');
  assert.equal(run('crackPose'), null);
  assert.equal(run(`$('crack').style.transform`), '');
});

test('attack styles map to the attacking figure', () => {
  assert.equal(run("attackOf('p')"), 'beam');
  assert.equal(run("attackOf('b')"), 'arc');
  assert.equal(run("attackOf('r')"), 'arc');
  assert.equal(run("attackOf('n')"), 'dash');
  assert.equal(run("attackOf('q')"), 'beam');
  assert.equal(run("attackOf('k')"), 'beam');
  assert.equal(run("attackOf('t')"), 'warp');
  assert.equal(run("attackOf('c')"), 'hurl');
});

test('attack coordinates follow the flipped board', () => {
  run("MP.active = true; MP.meColor = 'b'");
  assert.equal(run('visualIndex(0)'), 63);
  assert.deepEqual(js(run('boardPoint(0, 80)')), { x: 600, y: 600 });
  assert.deepEqual(js(run('boardPoint(63, 80)')), { x: 40, y: 40 });
  run("MP.meColor = 'w'");
  assert.deepEqual(js(run('boardPoint(0, 80)')), { x: 40, y: 40 });
  run('MP.active = false; MP.meColor = null');
});

test('captures are recorded for the spoils tray and leave a scar', () => {
  run('game = newChess()');
  play([
    { from: at('e2'), to: at('e4') },
    { from: at('d7'), to: at('d5') },
    { from: at('e4'), to: at('d5') },
  ]);
  assert.deepEqual(js(run('game.captured')), ['p']);
  assert.deepEqual(js(run(`spoils(game, 'b')`)), ['p']);
  assert.deepEqual(js(run(`spoils(game, 'w')`)), []);
  assert.deepEqual(js(run('game.scars')), [{ sq: at('d5'), kind: 'burn' }]);
});

test('a knight capture leaves a crater', () => {
  run('game = newChess()');
  play([
    { from: at('b1'), to: at('c3') },
    { from: at('d7'), to: at('d5') },
    { from: at('c3'), to: at('d5') },
  ]);
  assert.equal(run('game.last.attack'), 'dash');
  assert.deepEqual(js(run('game.scars')), [{ sq: at('d5'), kind: 'crater' }]);
  play([{ from: at('e7'), to: at('e5') }]);
  assert.deepEqual(js(run('game.scars')), [{ sq: at('d5'), kind: 'crater' }]);
});

test('tapping the selected figure lets go', () => {
  run('game = newChess()');
  run(`onSquare(${at('e2')})`);
  run(`onSquare(${at('e2')})`);
  assert.equal(run('sel'), -1);
  assert.deepEqual(js(run('targets')), []);
});

test('applyMove rejects wrong turns, illegal moves and bad squares', () => {
  run('game = newChess()');
  assert.equal(apply({ from: at('e7'), to: at('e5') }).ok, false);
  assert.equal(apply({ from: at('e2'), to: at('e5') }).ok, false);
  assert.equal(apply({ from: -1, to: at('e4') }).ok, false);
  assert.equal(apply({ from: 99, to: at('e4') }).ok, false);

  const result = apply({ from: at('e2'), to: at('e4') });
  assert.equal(result.ok, true);
  assert.equal(result.state.turn, 'b');
  assert.equal(result.state.last.from, at('e2'));
  assert.equal(result.state.last.to, at('e4'));
  run(`game = ${JSON.stringify(result.state)}`);
  assert.equal(apply({ from: at('e2'), to: at('e4') }).ok, false);
});

test('state serialization validates tampered payloads and envelopes', () => {
  assert.equal(run('validState(newChess())'), true);

  const short = js(run('newChess()'));
  short.board.pop();
  assert.equal(run(`validState(${JSON.stringify(short)})`), false);

  const badTurn = js(run('newChess()'));
  badTurn.turn = 'x';
  assert.equal(run(`validState(${JSON.stringify(badTurn)})`), false);

  const badStatus = js(run('newChess()'));
  badStatus.status = 'exploded';
  assert.equal(run(`validState(${JSON.stringify(badStatus)})`), false);

  const badScar = js(run('newChess()'));
  badScar.scars = [{ sq: 3, kind: 'lava' }];
  assert.equal(run(`validState(${JSON.stringify(badScar)})`), false);

  const warp = js(run('newChess()'));
  warp.last = { from: 0, to: 1, attack: 'warp', warp: true, suicide: true, captured: 'r', captureAt: 1 };
  assert.equal(run(`validState(${JSON.stringify(warp)})`), true);
  warp.last.attack = 'teleport';
  assert.equal(run(`validState(${JSON.stringify(warp)})`), false);

  const shot = js(run('newChess()'));
  shot.last = { from: 0, to: 1, attack: 'hurl', shot: true, captured: 'r', captureAt: 1 };
  assert.equal(run(`validState(${JSON.stringify(shot)})`), true);
  shot.last.shot = 'yes';
  assert.equal(run(`validState(${JSON.stringify(shot)})`), false);

  assert.equal(run(`isGameMessage({ v: 1, type: 'move', to: 'x', move: {} })`), true);
  assert.equal(run(`isGameMessage({ v: 2, type: 'move' })`), false);
  assert.equal(run(`isGameMessage({ v: 1, type: 'explode' })`), false);
  assert.equal(run(`isGameMessage([])`), false);

  assert.equal(run(`validPlayers([{ id: 'a', name: 'A', color: 'w' }, { id: 'b', name: 'B', color: 'b' }])`), true);
  assert.equal(run(`validPlayers([{ id: 'a', name: 'A', color: 'w' }, { id: 'b', name: 'B', color: 'w' }])`), false);
  assert.equal(run(`validPlayers([{ id: 'a', name: 'A', color: 'x' }])`), false);
});

test('tapping a piece then a target plays the move', () => {
  run('game = newChess()');
  run(`onSquare(${at('e2')})`);
  assert.equal(run('sel'), at('e2'));
  assert.deepEqual(js(run('targets.map(m => m.to).sort((a, b) => a - b)')),
    [at('e3'), at('e4')].sort((a, b) => a - b));

  run(`onSquare(${at('e4')})`);
  assert.equal(run(`game.board[${at('e4')}]`), 'P');
  assert.equal(run('game.turn'), 'b');
  assert.equal(run('sel'), -1);
  assert.deepEqual(js(run('targets')), []);
});

test('a capture updates the board and leaves a scar', () => {
  run('game = newChess()');
  const tap = square => run(`onSquare(${at(square)})`);
  tap('e2'); tap('e4');
  tap('d7'); tap('d5');
  tap('e4'); tap('d5');
  assert.equal(run(`game.board[${at('d5')}]`), 'P');
  assert.equal(run(`game.board[${at('e4')}]`), null);
  assert.deepEqual(js(run('game.scars')), [{ sq: at('d5'), kind: 'burn' }]);
  assert.equal(run('game.turn'), 'b');
  assert.equal(run('animating'), false);
  assert.equal(run('view'), null);
});

test('the host applies guest moves and guests accept host state', () => {
  run(`
    MP.active = true; MP.host = true; MP.you = 'host'; MP.meColor = 'w'; MP.socket = null;
    MP.players = [{ id: 'host', name: 'H', color: 'w' }, { id: 'guest', name: 'G', color: 'b' }];
    game = newChess(); sel = -1; targets = [];
  `);
  run(`commitMove({ from: ${at('e2')}, to: ${at('e4')} })`);
  assert.equal(run('game.turn'), 'b');

  run(`handleGameMessage('guest', { v: 1, type: 'move', to: 'host', move: { from: ${at('e7')}, to: ${at('e5')} } })`);
  assert.equal(run(`game.board[${at('e5')}]`), 'p');
  assert.equal(run('game.turn'), 'w');

  const state = js(run('game'));
  run(`
    MP.host = false; MP.you = 'guest'; MP.hostId = 'host'; MP.meColor = null; MP.pending = true;
    handleGameMessage('host', { v: 1, type: 'state', state: ${JSON.stringify(state)},
      players: [{ id: 'host', name: 'H', color: 'w' }, { id: 'guest', name: 'G', color: 'b' }] });
  `);
  assert.equal(run('MP.meColor'), 'b');
  assert.equal(run('MP.pending'), false);
  assert.equal(run(`game.board[${at('e5')}]`), 'p');
});

test('arc and dash capture spells apply their own wounds', () => {
  run('MP.active = false; MP.host = false; MP.meColor = null');

  const knightBoard = empty();
  put(knightBoard, 'e1', 'K'); put(knightBoard, 'e8', 'k');
  put(knightBoard, 'c3', 'N'); put(knightBoard, 'd5', 'p');
  setPosition({ board: knightBoard });
  run(`onSquare(${at('c3')})`);
  run(`onSquare(${at('d5')})`);
  assert.equal(run(`game.board[${at('d5')}]`), 'N');
  assert.equal(run('game.last.attack'), 'dash');
  assert.deepEqual(js(run('game.scars')), [{ sq: at('d5'), kind: 'crater' }]);

  const bishopBoard = empty();
  put(bishopBoard, 'e1', 'K'); put(bishopBoard, 'e8', 'k');
  put(bishopBoard, 'c1', 'B'); put(bishopBoard, 'g5', 'p');
  setPosition({ board: bishopBoard });
  run(`onSquare(${at('c1')})`);
  run(`onSquare(${at('g5')})`);
  assert.equal(run(`game.board[${at('g5')}]`), 'B');
  assert.equal(run('game.last.attack'), 'arc');
  assert.deepEqual(js(run('game.scars')), [{ sq: at('g5'), kind: 'cracked' }]);
});

test('a capture keeps the victim on the board until the spell resolves', () => {
  const realTimer = ctx.setTimeout;
  ctx.timers = [];
  ctx.setTimeout = (fn, ms) => { ctx.timers.push({ fn, ms }); };
  try {
    run('MP.active = false; MP.host = false; game = newChess(); sel = -1; targets = [];');
    const board = empty();
    put(board, 'e1', 'K'); put(board, 'e8', 'k');
    put(board, 'e4', 'P'); put(board, 'd5', 'p');
    setPosition({ board });

    run(`onSquare(${at('e4')})`);
    run(`onSquare(${at('d5')})`);

    // The board still shows the old position while the spell is in flight.
    const during = run(`$('board').innerHTML`);
    assert.match(during, new RegExp(`data-sq="${at('d5')}" aria-label="[^"]*Emerald pawn"`));
    assert.match(during, new RegExp(`data-sq="${at('e4')}" aria-label="[^"]*Gold pawn"`));
    assert.equal(run('animating'), true);
    assert.equal(run('view') === null, false);
    assert.equal(run('game.turn'), 'b');

    run(`
      while (timers.length) {
        timers.sort((a, b) => a.ms - b.ms);
        timers.shift().fn();
      }
    `);

    const after = run(`$('board').innerHTML`);
    assert.match(after, new RegExp(`data-sq="${at('d5')}" aria-label="[^"]*Gold pawn"`));
    assert.match(after, new RegExp(`data-sq="${at('e4')}" aria-label="[^"]*empty"`));
    assert.match(after, /class="scar burn"/);
    assert.equal(run('animating'), false);
    assert.equal(run('view'), null);
    assert.deepEqual(js(run('game.scars')), [{ sq: at('d5'), kind: 'burn' }]);
  } finally {
    ctx.setTimeout = realTimer;
    delete ctx.timers;
  }
});

test('a guest plays the incoming capture spell and applies its scar', () => {
  const board = empty();
  put(board, 'e1', 'K'); put(board, 'e8', 'k');
  put(board, 'e4', 'P'); put(board, 'd5', 'p');
  setPosition({ board });
  run(`next = applyMove(game, { from: ${at('e4')}, to: ${at('d5')} }).state`);
  run(`
    MP.active = true; MP.host = false; MP.you = 'guest'; MP.hostId = 'host'; MP.meColor = 'w'; MP.socket = null;
    MP.players = [{ id: 'host', name: 'H', color: 'b' }, { id: 'guest', name: 'G', color: 'w' }];
    MP.pending = true;
    handleGameMessage('host', { v: 1, type: 'state', state: next,
      players: [{ id: 'host', name: 'H', color: 'b' }, { id: 'guest', name: 'G', color: 'w' }] });
  `);
  assert.equal(run(`game.board[${at('d5')}]`), 'P');
  assert.deepEqual(js(run('game.scars')), [{ sq: at('d5'), kind: 'burn' }]);
  assert.equal(run('MP.pending'), false);
  assert.equal(run('animating'), false);
  assert.equal(run('view'), null);
});
