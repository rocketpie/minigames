// Game logic tests for dreiziehn.html: `node --test`
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

// Run the page's <script> with a stub DOM so we can drive the real move/select code.
const code = readFileSync(new URL('./dreiziehn.html', import.meta.url), 'utf8')
  .match(/<script>([\s\S]*)<\/script>/)[1];
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
  addEventListener() {}, requestAnimationFrame: fn => fn(), setTimeout: fn => fn(), clearTimeout() {},
  innerWidth: 900, innerHeight: 900, console,
  location: {
    href: 'http://localhost:8000/dreiziehn/dreiziehn.html',
    origin: 'http://localhost:8000',
    pathname: '/dreiziehn/dreiziehn.html',
    hostname: 'localhost',
    protocol: 'http:',
    host: 'localhost:8000',
    search: '',
    hash: '',
  },
  URL,
  URLSearchParams,
  localStorage: {
    getItem: k => store.get(k) ?? null,
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: k => store.delete(k),
  },
};
vm.createContext(ctx);
vm.runInContext(code, ctx);

const run = expression => vm.runInContext(expression, ctx);
const c = (r, s, j) => r === 0 ? { r: 0, s, j } : { r, s };
const cid = x => x.s * 32 + x.r * 2 + (x.j || 0);
const mc = id => {
  const p = Math.floor(id / 60);
  const k = id % 60;
  const s = Math.floor(k / 15);
  const m = k % 15;
  return m < 13 ? { p, k, s, r: m + 1 } : { p, k, s, r: 0, j: m - 13 };
};
const allCards = () => {
  const cards = [];
  for (let s = 0; s < 4; s++) {
    for (let r = 1; r <= 13; r++) cards.push(c(r, s));
    cards.push(c(0, s, 0), c(0, s, 1));
  }
  return cards;
};
const setup = ({
  stock = [], hand = [], own = [[], [], [], []], middle = [[], [], [], []],
  completed = 0, turnPlayed = false, turns = 0, plays = 0,
}) => {
  store.delete('dreiziehn');
  run(`
    stock = ${JSON.stringify(stock)};
    hand = ${JSON.stringify(hand)};
    own = ${JSON.stringify(own)};
    middle = ${JSON.stringify(middle)};
    completed = ${completed};
    turnPlayed = ${turnPlayed};
    turns = ${turns};
    plays = ${plays};
    won = false;
    sel = null;
    undoStack = [];
    MP.active = false; MP.host = false; MP.you = null; MP.hostId = null; MP.room = null;
    MP.peers = []; MP.maxPlayers = 4; MP.state = null; MP.meIndex = -1;
    MP.pending = false; MP.timer = null; MP.socket = null;
    lobbyMax = 0;
    draw();
  `);
};

test('a deck is 60 cards: 52 plus two jokers per suit', () => {
  const cards = JSON.parse(run('JSON.stringify(deck())'));
  assert.equal(cards.length, 60);
  for (let s = 0; s < 4; s++) {
    assert.equal(cards.filter(x => x.s === s && x.r > 0).length, 13, `suit ${s} ranks`);
    assert.equal(cards.filter(x => x.s === s && x.r === 0).length, 2, `suit ${s} jokers`);
  }
  assert.equal(new Set(cards.map(cid)).size, 60);
});

test('new game deals five cards and leaves the rest in the stock', () => {
  run('newGame()');
  assert.equal(run('hand.length'), 5);
  assert.equal(run('stock.length'), 55);
  assert.equal(run('own.every(p => p.length === 0)'), true);
  assert.equal(run('middle.every(p => p.length === 0)'), true);
  assert.equal(run('completed'), 0);
  assert.equal(run('turnPlayed'), false);
  const ids = JSON.parse(run('JSON.stringify([...stock, ...hand].map(cid))'));
  assert.equal(new Set(ids).size, 60);
});

test('the middle piles build from ace upward, whatever the suit', () => {
  setup({ hand: [c(1, 0), c(2, 1), c(5, 2)] });
  run('sel = {kind:"hand", i:0}; playMiddle(0)');
  assert.deepEqual(Array.from(run('middle[0].map(c => c.r)')), [1]);
  run('sel = {kind:"hand", i:0}; playMiddle(0)');
  assert.deepEqual(Array.from(run('middle[0].map(c => c.r)')), [1, 2]);
  run('sel = {kind:"hand", i:0}; playMiddle(0)');
  assert.equal(run('middle[0].length'), 2, 'a five does not fit on a two');
});

test('a joker is wild on the middle piles', () => {
  setup({ hand: [c(0, 0, 0), c(1, 1), c(2, 2)] });
  run('sel = {kind:"hand", i:0}; playMiddle(0)');
  assert.equal(run('middle[0].length'), 1);
  assert.equal(run('middle[0][0].r'), 0);
  run('sel = {kind:"hand", i:0}; playMiddle(0)');
  assert.equal(run('middle[0].length'), 1, 'the joker stood in for an ace, so an ace no longer fits');
  run('sel = {kind:"hand", i:1}; playMiddle(0)');
  assert.equal(run('middle[0].length'), 2);
  assert.equal(run('middle[0][1].r'), 2);
});

test('a king completes a middle pile and frees its slot', () => {
  const twelve = Array.from({ length: 12 }, (_, i) => c(i + 1, 0));
  setup({ hand: [c(13, 0), c(1, 1)], middle: [twelve, [], [], []] });
  run('sel = {kind:"hand", i:0}; playMiddle(0)');
  assert.equal(run('completed'), 1);
  assert.equal(run('middle[0].length'), 0);
  assert.equal(run('plays'), 1);
  run('sel = {kind:"hand", i:0}; playMiddle(0)');
  assert.equal(run('middle[0].length'), 1);
  assert.equal(run('middle[0][0].r'), 1, 'the slot starts again at an ace');
});

test('a joker can finish a pile', () => {
  const twelve = Array.from({ length: 12 }, (_, i) => c(i + 1, 0));
  setup({ hand: [c(0, 1, 1)], middle: [twelve, [], [], []] });
  run('sel = {kind:"hand", i:0}; playMiddle(0)');
  assert.equal(run('completed'), 1);
  assert.equal(run('middle[0].length'), 0);
});

test('own piles take any card in any order and give the top one back', () => {
  setup({ hand: [c(5, 0), c(9, 1)] });
  run('sel = {kind:"hand", i:0}; playOwn(2)');
  assert.equal(run('own[2].length'), 1);
  assert.equal(run('own[2][0].r'), 5);
  run('sel = {kind:"hand", i:0}; playOwn(2)');
  assert.deepEqual(Array.from(run('own[2].map(c => c.r)')), [5, 9]);
  assert.equal(run('hand.length'), 0);

  run('pickUpOwn(2)');
  assert.equal(run('own[2].length'), 1);
  assert.equal(run('hand[0].r'), 9);
  run('pickUpOwn(2)');
  assert.equal(run('own[2].length'), 0);
  assert.equal(run('hand[1].r'), 5);
});

test('the hand never holds more than five cards', () => {
  setup({
    hand: [c(1, 0), c(2, 1), c(3, 2), c(4, 3), c(5, 0)],
    own: [[c(6, 1)], [], [], []],
  });
  assert.equal(run('pickUpOwn(0)'), false);
  assert.equal(run('own[0].length'), 1);
  assert.equal(run('hand.length'), 5);
});

test('a turn needs a card, then refills from the stock', () => {
  const stock = Array.from({ length: 10 }, (_, i) => c(i + 1, i % 4));
  setup({ stock, hand: [c(1, 0)] });
  assert.equal(run('endTurn()'), false);
  assert.equal(run('turns'), 0);

  run('sel = {kind:"hand", i:0}; playMiddle(0)');
  assert.equal(run('turnPlayed'), true);
  assert.equal(run('endTurn()'), true);
  assert.equal(run('turns'), 1);
  assert.equal(run('hand.length'), 5);
  assert.equal(run('stock.length'), 5);
  assert.equal(run('turnPlayed'), false);
});

test('you can take a card from a pile before the stock refills you', () => {
  const stock = Array.from({ length: 10 }, (_, i) => c(i + 1, i % 4));
  setup({ stock, hand: [c(1, 0)], own: [[c(6, 1)], [], [], []] });
  run('sel = {kind:"hand", i:0}; playMiddle(0)');
  run('pickUpOwn(0)');
  assert.equal(run('hand.length'), 1);
  run('endTurn()');
  assert.equal(run('hand.length'), 5);
  assert.equal(run('stock.length'), 6);
});

test('clearing the stock and all four piles wins, even with cards in hand', () => {
  setup({ stock: [], hand: [c(5, 0)], middle: [[c(1, 0)], [], [], []] });
  run('sel = {kind:"hand", i:0}; playOwn(0)');
  assert.equal(run('won'), false, 'the own pile is not empty yet');
  run('pickUpOwn(0)');
  assert.equal(run('won'), true);
  assert.equal(run('hand.length'), 1);
});

test('a card in the stock keeps the game going', () => {
  setup({ stock: [c(2, 0)], middle: [[c(1, 0)], [], [], []] });
  run('checkWin()');
  assert.equal(run('won'), false);
});

test('a full table can be cleared', () => {
  const pile = (suit, n) => Array.from({ length: n }, (_, i) => c(i + 1, suit));
  setup({
    completed: 2,
    middle: [pile(0, 7), pile(1, 7), pile(2, 7), pile(3, 8)],
    hand: [c(8, 0), c(8, 1), c(8, 2), c(9, 3), c(9, 0)],
  });
  for (let i = 0; i < 5; i++) {
    run(`sel = {kind:"hand", i:0}; playMiddle(${i === 4 ? 0 : i})`);
  }
  assert.equal(run('won'), true);
  assert.equal(run('hand.length'), 0);
  assert.equal(run('stock.length'), 0);
});

test('undo restores the card, counters and turn flag', () => {
  const all = allCards();
  const ace = c(1, 0);
  setup({ stock: all.filter(x => cid(x) !== cid(ace)), hand: [ace] });
  run('sel = {kind:"hand", i:0}; playMiddle(0)');
  assert.equal(run('plays'), 1);
  assert.equal(run('turnPlayed'), true);
  run('undo()');
  assert.equal(run('plays'), 0);
  assert.equal(run('turnPlayed'), false);
  assert.equal(run('hand.length'), 1);
  assert.equal(run('middle[0].length'), 0);
  assert.equal(run('undoStack.length'), 0);
});

test('undo takes back a refill', () => {
  const all = allCards();
  const ace = c(1, 0);
  setup({ stock: all.filter(x => cid(x) !== cid(ace)), hand: [ace] });
  run('sel = {kind:"hand", i:0}; playMiddle(0)');
  run('endTurn()');
  assert.equal(run('hand.length'), 5);
  assert.equal(run('stock.length'), 54);
  run('undo()');
  assert.equal(run('hand.length'), 0);
  assert.equal(run('stock.length'), 59);
  assert.equal(run('turns'), 0);
  assert.equal(run('turnPlayed'), true);
});

test('saves and restores a game', () => {
  const all = allCards();
  const middle0 = [c(1, 0), c(2, 0)];
  const own0 = [c(5, 1), c(9, 2)];
  const own1 = [c(12, 3)];
  const handCards = [c(1, 1), c(2, 2), c(3, 3), c(4, 0), c(6, 1)];
  const used = new Set([...middle0, ...own0, ...own1, ...handCards].map(cid));
  const stock = all.filter(x => !used.has(cid(x)));

  setup({
    stock, hand: handCards, own: [own0, own1, [], []], middle: [middle0, [], [], []],
    turns: 2, plays: 3, turnPlayed: true,
  });
  run('save()');
  run('stock=[]; hand=[]; own=[[],[],[],[]]; middle=[[],[],[],[]]; completed=0; turns=0; plays=0; turnPlayed=false; won=false;');
  assert.equal(run('load()'), true);
  assert.equal(run('hand.length'), 5);
  assert.equal(run('own[0].length'), 2);
  assert.equal(run('own[1][0].r'), 12);
  assert.equal(run('middle[0].length'), 2);
  assert.equal(run('turns'), 2);
  assert.equal(run('plays'), 3);
  assert.equal(run('turnPlayed'), true);
  assert.equal(run('won'), false);
});

test('a completed pile is part of the save', () => {
  const all = allCards();
  const removed = new Set(Array.from({ length: 13 }, (_, i) => cid(c(i + 1, 0))));
  const rest = all.filter(x => !removed.has(cid(x)));
  setup({
    stock: rest.slice(5), hand: rest.slice(0, 5), completed: 1,
  });
  run('save()');
  run('completed=0; stock=[]; hand=[];');
  assert.equal(run('load()'), true);
  assert.equal(run('completed'), 1);
  assert.equal(run('stock.length'), 42);
});

test('a corrupt save is ignored', () => {
  ctx.localStorage.setItem('dreiziehn', '{"stock":[]}');
  assert.equal(run('load()'), false);

  const all = allCards();
  const two = c(2, 0);
  const rest = all.filter(x => cid(x) !== cid(two));
  const bad = {
    stock: rest, hand: [], own: [[], [], [], []], middle: [[two], [], [], []],
    completed: 0, turnPlayed: false, turns: 0, plays: 0, won: false, undoStack: [],
  };
  ctx.localStorage.setItem('dreiziehn', JSON.stringify(bad));
  assert.equal(run('load()'), false, 'a middle pile must start with an ace or joker');
  store.delete('dreiziehn');
});

test('number cards show exactly as many pips as their rank', () => {
  for (let r = 2; r <= 10; r++) {
    const html = run(`faceHTML({ r:${r}, s:0 })`);
    assert.equal((html.match(/class="pip"/g) || []).length, r, `rank ${r}`);
  }
  assert.equal((run('faceHTML({ r:1, s:1 })').match(/class="pip"/g) || []).length, 1);
  assert.equal((run('faceHTML({ r:12, s:2 })').match(/class="corner /g) || []).length, 2);
});

test('jokers render as jokers', () => {
  const html = run('faceHTML({ r:0, s:0, j:0 })');
  assert.match(html, /JOKER/);
  assert.equal((html.match(/class="corner /g) || []).length, 2);
});

test('tapping a hand card then a middle pile plays it', () => {
  setup({ hand: [c(1, 0)] });
  run('tapHand(0)');
  assert.deepEqual(JSON.parse(run('JSON.stringify(sel)')), { kind: 'hand', i: 0 });
  run('tapMiddle(0)');
  assert.equal(run('middle[0].length'), 1);
  assert.equal(run('hand.length'), 0);
  assert.equal(run('sel'), null);
});

test('tapping your pile without a selected card takes its top card', () => {
  setup({ hand: [c(1, 0)], own: [[c(7, 2)], [], [], []] });
  run('tapOwn(0)');
  assert.equal(run('own[0].length'), 0);
  assert.equal(run('hand.length'), 2);
  assert.equal(run('hand[1].r'), 7);
});

test('tapping the selected card again puts it back', () => {
  setup({ hand: [c(1, 0)] });
  run('tapHand(0)');
  run('tapHand(0)');
  assert.equal(run('sel'), null);
});

test('the middle pile tells you the next rank', () => {
  assert.equal(run('nextRank([])'), 'A');
  assert.equal(run('nextRank([{r:1,s:0}])'), '2');
  assert.equal(run('nextRank(Array.from({length:12},(_,i)=>({r:i+1,s:0})))'), 'K');
});

test('the multiplayer button opens the lobby with the game as return url', () => {
  assert.equal(run('gameUrl()'), 'http://localhost:8000/dreiziehn/dreiziehn.html');
  assert.equal(
    run('lobbyUrl(gameUrl())'),
    'http://localhost:8080/?return=http%3A%2F%2Flocalhost%3A8000%2Fdreiziehn%2Fdreiziehn.html&maxPlayers=4',
  );
  assert.equal(run('defaultLobbyWs()'), 'ws://localhost:8080/ws');
  assert.equal(run('safeLobby("wss://lobby.co3d.eu/ws")'), 'wss://lobby.co3d.eu/ws');
  assert.equal(run('safeLobby("ws://localhost:8080/ws")'), 'ws://localhost:8080/ws');
  assert.equal(run('safeLobby("wss://evil.example/ws")'), '');
});

test('room, token and name are read from the return url', () => {
  assert.deepEqual(
    JSON.parse(run(
      `JSON.stringify(lobbyParams("?room=abc", "#token=t&name=Ada&lobby=ws%3A%2F%2Flocalhost%3A8080%2Fws"))`,
    )),
    { room: 'abc', token: 't', name: 'Ada', lobby: 'ws://localhost:8080/ws' },
  );
  assert.deepEqual(
    JSON.parse(run('JSON.stringify(lobbyParams("", ""))')),
    { room: null, token: null, name: null, lobby: null },
  );
});

test('lobby messages update the room bar', () => {
  run('handleLobby({t:"joined", room:"1234567890", host:false, you:"b1", started:true, maxPlayers:4, peers:[{id:"h1",name:"Ada",host:true,online:true},{id:"b1",name:"Bob",host:false,online:false}]})');
  assert.equal(ctx.document.getElementById('lobbyState').textContent, 'Room 12345678 · player · started');
  assert.equal(ctx.document.getElementById('lobbyPeers').textContent, '2/4 · Ada (host) · Bob (offline)');

  run('handleLobby({t:"error", code:"closed"})');
  assert.equal(ctx.document.getElementById('lobbyState').textContent, 'Lobby error: closed');
  run('MP.active=false; MP.state=null; MP.host=false; MP.meIndex=-1;');
});

test('game data needs a known version and type', () => {
  assert.equal(run('isGameMessage({v:1,type:"state"})'), true);
  assert.equal(run('isGameMessage({v:1,type:"move"})'), true);
  assert.equal(run('isGameMessage({v:2,type:"state"})'), false);
  assert.equal(run('isGameMessage({type:"state"})'), false);
  assert.equal(run('isGameMessage({v:1,type:"nope"})'), false);
  assert.equal(run('isGameMessage(null)'), false);
  assert.equal(run('isGameMessage([])'), false);
});

test('multiplayer state must have a valid shape', () => {
  const good = {
    turn: 0, winner: null, completed: 0, turnPlayed: false,
    middle: [[0], [], [], []],
    players: [{ id: 'h1', name: 'Host', stock: [], hand: [1], own: [[], [], [], []] }],
  };
  assert.equal(run(`isMultiState(${JSON.stringify(good)})`), true);
  assert.equal(run(`isMultiState(${JSON.stringify({ ...good, turn: 5 })})`), false);
  assert.equal(run(`isMultiState(${JSON.stringify({ ...good, middle: [[1], [], [], []] })})`), false);
  assert.equal(run('isMultiState(null)'), false);
});

test('the host deals a full deck to every player', () => {
  run(`
    MP.active=true; MP.host=true; MP.you='h1'; MP.hostId='h1'; MP.state=null;
    MP.peers=[{id:'h1',name:'Host',host:true,online:true},{id:'g1',name:'Guest',host:false,online:true}];
    mpHostStart(MP.peers);
  `);
  assert.equal(run('MP.state.players.length'), 2);
  assert.equal(run('MP.state.players[0].stock.length'), 55);
  assert.equal(run('MP.state.players[0].hand.length'), 5);
  assert.equal(run('MP.state.players[1].stock.length'), 55);
  assert.equal(run('MP.state.players[1].hand.length'), 5);
  const ids = JSON.parse(run(
    'JSON.stringify(MP.state.players.flatMap(p => [...p.stock, ...p.hand]).map(sid))',
  ));
  assert.equal(new Set(ids).size, 120);
});

test('a played ace lands in the shared middle and serializes for guests', () => {
  const state = {
    turn: 0, winner: null, completed: 0, turnPlayed: false,
    middle: [[], [], [], []],
    players: [
      { id: 'h1', name: 'Host', stock: [mc(2)], hand: [mc(0)], own: [[], [], [], []] },
      { id: 'g1', name: 'Guest', stock: [mc(60)], hand: [mc(61)], own: [[], [], [], []] },
    ],
  };
  run(`MP.active=true; MP.host=true; MP.you='h1'; MP.hostId='h1'; MP.meIndex=0; MP.state=${JSON.stringify(state)};`);
  run('sel={kind:"hand",i:0}; mpTapMiddle(0)');
  assert.equal(run('MP.state.middle[0].length'), 1);
  assert.equal(run('MP.state.middle[0][0].r'), 1);
  assert.equal(run('MP.state.turnPlayed'), true);

  const wire = JSON.parse(run('JSON.stringify(serializeState(MP.state))'));
  assert.deepEqual(wire.middle[0], [0]);
  const guestState = JSON.parse(run(`JSON.stringify(deserializeState(${JSON.stringify(wire)}))`));
  assert.equal(guestState.middle[0][0].r, 1);
  assert.equal(guestState.middle[0][0].s, 0);
});

test('a guest renders the shared middle from the host state', () => {
  const hostState = {
    turn: 1, winner: null, completed: 0, turnPlayed: false,
    middle: [[mc(0)], [], [], []],
    players: [
      { id: 'h1', name: 'Host', stock: [], hand: [], own: [[], [], [], []] },
      { id: 'g1', name: 'Guest', stock: [], hand: [mc(61)], own: [[], [], [], []] },
    ],
  };
  const wire = JSON.parse(run(`JSON.stringify(serializeState(${JSON.stringify(hostState)}))`));
  run(`MP.active=true; MP.host=false; MP.you='g1'; MP.hostId='h1'; MP.meIndex=1; MP.state=null;`);
  run(`mpHandleGameMessage('h1', ${JSON.stringify({ v: 1, type: 'state', state: wire })})`);
  assert.equal(run('MP.state.middle[0][0].r'), 1);
  assert.match(ctx.document.getElementById('middle').innerHTML, /Ace of spades/);
  assert.equal(ctx.document.getElementById('turnBar').textContent, 'Dein Zug!');
});

test('the host accepts a guest move and updates the shared middle', () => {
  const state = {
    turn: 1, winner: null, completed: 0, turnPlayed: false,
    middle: [[], [], [], []],
    players: [
      { id: 'h1', name: 'Host', stock: [mc(2)], hand: [mc(0)], own: [[], [], [], []] },
      { id: 'g1', name: 'Guest', stock: [mc(61)], hand: [mc(60)], own: [[], [], [], []] },
    ],
  };
  run(`MP.active=true; MP.host=true; MP.you='h1'; MP.hostId='h1'; MP.meIndex=0; MP.state=${JSON.stringify(state)};`);
  run(`mpHandleGameMessage('g1', {v:1,type:'move',to:'h1',move:{kind:'middle',card:0,pile:0}})`);
  assert.equal(run('MP.state.middle[0].length'), 1);
  assert.equal(run('MP.state.middle[0][0].r'), 1);
  assert.equal(run('MP.state.players[1].hand.length'), 0);
});

test('ending a turn passes it to the next player', () => {
  const state = {
    turn: 0, winner: null, completed: 0, turnPlayed: true,
    middle: [[], [], [], []],
    players: [
      { id: 'h1', name: 'Host', stock: [mc(2), mc(3), mc(4), mc(5), mc(6)], hand: [mc(0)], own: [[], [], [], []] },
      { id: 'g1', name: 'Guest', stock: [mc(60)], hand: [mc(61)], own: [[], [], [], []] },
    ],
  };
  run(`MP.active=true; MP.host=true; MP.you='h1'; MP.hostId='h1'; MP.meIndex=0; MP.state=${JSON.stringify(state)};`);
  run('mpApplyHost({kind:"end"})');
  assert.equal(run('MP.state.players[0].hand.length'), 5);
  assert.equal(run('MP.state.players[0].stock.length'), 1);
  assert.equal(run('MP.state.turn'), 1);
  assert.equal(run('MP.state.turnPlayed'), false);
  assert.equal(run('mpIsMyTurn()'), false);
});

test('drawing the last stock cards at the end of a turn wins', () => {
  const state = {
    turn: 0, winner: null, completed: 0, turnPlayed: true,
    middle: [[], [], [], []],
    players: [
      { id: 'h1', name: 'Host', stock: [mc(2)], hand: [mc(0)], own: [[], [], [], []] },
      { id: 'g1', name: 'Guest', stock: [mc(60)], hand: [mc(61)], own: [[], [], [], []] },
    ],
  };
  run(`MP.active=true; MP.host=true; MP.you='h1'; MP.hostId='h1'; MP.meIndex=0; MP.state=${JSON.stringify(state)};`);
  run('mpApplyHost({kind:"end"})');
  assert.equal(run('MP.state.players[0].hand.length'), 2);
  assert.equal(run('MP.state.players[0].stock.length'), 0);
  assert.equal(run('MP.state.winner'), 0);
});

test('a player with an empty stock and empty piles wins by playing a card', () => {
  const state = {
    turn: 0, winner: null, completed: 0, turnPlayed: false,
    middle: [[], [], [], []],
    players: [
      { id: 'h1', name: 'Host', stock: [], hand: [mc(0)], own: [[], [], [], []] },
      { id: 'g1', name: 'Guest', stock: [mc(60)], hand: [mc(61)], own: [[], [], [], []] },
    ],
  };
  run(`MP.active=true; MP.host=true; MP.you='h1'; MP.hostId='h1'; MP.meIndex=0; MP.state=${JSON.stringify(state)};`);
  run('sel={kind:"hand",i:0}; mpTapMiddle(0)');
  assert.equal(run('MP.state.winner'), 0);
  assert.match(ctx.document.getElementById('winTitle').textContent, /Dreiziehn/);
});
