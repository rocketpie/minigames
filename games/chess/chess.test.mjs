// Game logic tests for chess.html: `node --test`
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

// Run the page's <script> with a stub DOM so we can drive the real rules and tap code.
const code = readFileSync(new URL('./chess.html', import.meta.url), 'utf8')
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
    href: 'http://localhost:8000/chess/chess.html',
    origin: 'http://localhost:8000',
    pathname: '/chess/chess.html',
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

test('initial position: 32 figures, 20 legal moves, Gold starts', () => {
  run('game = newChess()');
  assert.equal(run('game.board.filter(Boolean).length'), 32);
  assert.equal(run('game.turn'), 'w');
  assert.equal(run('allLegalMoves(game).length'), 20);
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
  assert.equal(options.filter(m => m.promo).length, 4);
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
});

test("fool's mate is checkmate", () => {
  run('game = newChess()');
  play([
    { from: at('f2'), to: at('f3') },
    { from: at('e7'), to: at('e5') },
    { from: at('g2'), to: at('g4') },
    { from: at('d8'), to: at('h4') },
  ]);
  assert.equal(run('game.status'), 'checkmate');
  assert.equal(run('game.winner'), 'b');
  assert.equal(run('allLegalMoves(game).length'), 0);
  assert.equal(run(`inCheck(game, 'w')`), true);
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

test('attack styles map to the attacking figure', () => {
  assert.equal(run("attackOf('p')"), 'beam');
  assert.equal(run("attackOf('b')"), 'arc');
  assert.equal(run("attackOf('r')"), 'arc');
  assert.equal(run("attackOf('n')"), 'dash');
  assert.equal(run("attackOf('q')"), 'beam');
  assert.equal(run("attackOf('k')"), 'beam');
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
