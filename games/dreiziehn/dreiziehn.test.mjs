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
  confirm: () => true,
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
  stack = [], drawPile = [], hand = [], own = [[], [], [], []], middle = [[], [], [], []],
  completed = 0, placed = [false, false, false, false],
  turnPlayed = false, turns = 0, plays = 0,
}) => {
  store.delete('dreiziehn');
  run(`
    stack = ${JSON.stringify(stack)};
    drawPile = ${JSON.stringify(drawPile)};
    hand = ${JSON.stringify(hand)};
    own = ${JSON.stringify(own)};
    middle = ${JSON.stringify(middle)};
    completed = ${completed};
    placed = ${JSON.stringify(placed)};
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

test('new game deals a 15-card stack and a 5-card hand from the shared draw', () => {
  run('newGame()');
  assert.equal(run('hand.length'), 5);
  assert.equal(run('stack.length'), 15);
  assert.equal(run('drawPile.length'), 40);
  assert.equal(run('own.every(p => p.length === 0)'), true);
  assert.equal(run('middle.every(p => p.length === 0)'), true);
  assert.equal(run('completed'), 0);
  assert.equal(run('turnPlayed'), false);
  const ids = JSON.parse(run(
    'JSON.stringify([...stack, ...drawPile, ...hand].map(cid))',
  ));
  assert.equal(new Set(ids).size, 60);
});

test('the middle piles build from 1 upward, whatever the suit', () => {
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
  assert.equal(run('middle[0].length'), 1, 'the joker stood in for a 1, so a 1 no longer fits');
  run('sel = {kind:"hand", i:1}; playMiddle(0)');
  assert.equal(run('middle[0].length'), 2);
  assert.equal(run('middle[0][1].r'), 2);
});

test('a 13 recycles the middle pile into the shared draw stack', () => {
  const twelve = Array.from({ length: 12 }, (_, i) => c(i + 1, 0));
  setup({
    hand: [c(13, 0), c(1, 1)], middle: [twelve, [], [], []], drawPile: [c(2, 3)],
  });
  run('sel = {kind:"hand", i:0}; playMiddle(0)');
  assert.equal(run('completed'), 1);
  assert.equal(run('middle[0].length'), 0);
  assert.equal(run('drawPile.length'), 14);
  assert.equal(run('plays'), 1);
  run('sel = {kind:"hand", i:0}; playMiddle(0)');
  assert.equal(run('middle[0].length'), 1);
  assert.equal(run('middle[0][0].r'), 1, 'the slot starts again at 1');
});

test('a joker can finish a pile', () => {
  const twelve = Array.from({ length: 12 }, (_, i) => c(i + 1, 0));
  setup({ hand: [c(0, 1, 1)], middle: [twelve, [], [], []], drawPile: [] });
  run('sel = {kind:"hand", i:0}; playMiddle(0)');
  assert.equal(run('completed'), 1);
  assert.equal(run('middle[0].length'), 0);
  assert.equal(run('drawPile.length'), 13);
});

test('caches take any card and never give one back to the hand', () => {
  setup({ hand: [c(5, 0), c(9, 1)] });
  run('sel = {kind:"hand", i:0}; playOwn(2)');
  assert.equal(run('own[2].length'), 1);
  assert.equal(run('own[2][0].r'), 5);
  run('sel = {kind:"hand", i:0}; playOwn(3)');
  assert.equal(run('own[3][0].r'), 9);
  assert.equal(run('hand.length'), 0);

  run('tapOwn(2)');
  assert.equal(run('hand.length'), 0, 'selecting a cache top does not take it into the hand');
  assert.deepEqual(JSON.parse(run('JSON.stringify(sel)')), { kind: 'own', i: 2 });
  assert.equal(run('selectedCard().r'), 5);
});

test('a cache top can only go to the middle, not to another cache', () => {
  setup({ own: [[c(1, 0), c(2, 1)], [], [], []], middle: [[c(1, 2)], [], [], []] });
  run('tapOwn(0)');
  run('tapOwn(1)');
  assert.equal(run('own[1].length'), 0, 'an own top is not a cache card');
  run('tapMiddle(0)');
  assert.deepEqual(Array.from(run('middle[0].map(c => c.r)')), [1, 2]);
  assert.deepEqual(Array.from(run('own[0].map(c => c.r)')), [1]);
  assert.equal(run('hand.length'), 0);
});

test('one hand card per cache each turn', () => {
  setup({ hand: [c(1, 0), c(2, 1), c(3, 2)] });
  run('sel = {kind:"hand", i:0}; playOwn(0)');
  assert.equal(run('placed[0]'), true);
  assert.equal(run('hand.length'), 2);
  run('sel = {kind:"hand", i:0}; playOwn(0)');
  assert.equal(run('hand.length'), 2, 'the second hand card stays put');
  assert.equal(run('own[0].length'), 1);
  run('sel = {kind:"hand", i:0}; playOwn(1)');
  assert.equal(run('hand.length'), 1);
  assert.equal(run('own[1].length'), 1);

  run('endTurn()');
  assert.deepEqual(Array.from(run('placed')), [false, false, false, false]);
});

test('the stack top plays like a hand card and reveals the next one', () => {
  setup({ stack: [c(5, 0), c(1, 1)] });
  run('tapStack()');
  assert.deepEqual(JSON.parse(run('JSON.stringify(sel)')), { kind: 'stack' });
  assert.equal(run('selectedCard().r'), 1);
  run('tapMiddle(0)');
  assert.equal(run('middle[0][0].r'), 1);
  assert.equal(run('stack.length'), 1);

  run('tapStack()');
  assert.equal(run('selectedCard().r'), 5);
  run('tapOwn(2)');
  assert.equal(run('stack.length'), 0);
  assert.equal(run('own[2][0].r'), 5);
});

test('a turn needs a card, then refills from the shared draw, never the stack', () => {
  const drawPile = Array.from({ length: 10 }, (_, i) => c(i + 1, i % 4));
  setup({ drawPile, hand: [c(1, 0)], stack: [c(11, 0)] });
  assert.equal(run('endTurn()'), false);
  assert.equal(run('turns'), 0);

  run('sel = {kind:"hand", i:0}; playMiddle(0)');
  assert.equal(run('turnPlayed'), true);
  assert.equal(run('endTurn()'), true);
  assert.equal(run('turns'), 1);
  assert.equal(run('hand.length'), 5);
  assert.equal(run('drawPile.length'), 5);
  assert.equal(run('stack.length'), 1);
  assert.equal(run('turnPlayed'), false);
});

test('clearing the stack and all caches wins, even with cards in hand', () => {
  setup({ stack: [], hand: [c(5, 0)], own: [[c(1, 0)], [], [], []] });
  run('tapOwn(0)');
  assert.equal(run('won'), false, 'the cache is not empty yet');
  run('tapMiddle(0)');
  assert.equal(run('won'), true);
  assert.equal(run('hand.length'), 1);
});

test('cards left in the stack or a cache keep the game going', () => {
  setup({ stack: [c(2, 0)] });
  run('checkWin()');
  assert.equal(run('won'), false, 'the stack is not empty');

  setup({ own: [[c(2, 0)], [], [], []] });
  run('checkWin()');
  assert.equal(run('won'), false, 'a cache is not empty');
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
  assert.equal(run('stack.length'), 0);
});

test('undo restores the card, counters and turn flag', () => {
  const all = allCards();
  const ace = c(1, 0);
  setup({ drawPile: all.filter(x => cid(x) !== cid(ace)), hand: [ace] });
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

test('undo takes back a refill and the per-cache hand limit', () => {
  const all = allCards();
  const ace = c(1, 0);
  const stackCard = c(11, 0);
  setup({
    stack: [stackCard], hand: [ace],
    drawPile: all.filter(x => cid(x) !== cid(ace) && cid(x) !== cid(stackCard)),
  });
  run('sel = {kind:"hand", i:0}; playMiddle(0)');
  run('endTurn()');
  assert.equal(run('hand.length'), 5);
  assert.equal(run('drawPile.length'), 53);
  assert.deepEqual(Array.from(run('placed')), [false, false, false, false]);
  run('undo()');
  assert.equal(run('hand.length'), 0);
  assert.equal(run('drawPile.length'), 58);
  assert.equal(run('turns'), 0);
  assert.equal(run('turnPlayed'), true);
});

test('saves and restores a game', () => {
  const all = allCards();
  const stackCards = all.slice(0, 15);
  const middle0 = [all[15], all[16]];
  const own0 = [all[17], all[18]];
  const own1 = [all[19]];
  const handCards = all.slice(20, 25);
  const used = new Set([...stackCards, ...middle0, ...own0, ...own1, ...handCards].map(cid));
  const drawPile = all.filter(x => !used.has(cid(x)));

  setup({
    stack: stackCards, drawPile, hand: handCards, own: [own0, own1, [], []],
    middle: [middle0, [], [], []], turns: 2, plays: 3, turnPlayed: true,
    placed: [true, false, false, false],
  });
  run('save()');
  run('stack=[]; drawPile=[]; hand=[]; own=[[],[],[],[]]; middle=[[],[],[],[]]; completed=0; placed=[false,false,false,false]; turns=0; plays=0; turnPlayed=false; won=false;');
  assert.equal(run('load()'), true);
  assert.equal(run('stack.length'), 15);
  assert.equal(run('drawPile.length'), 35);
  assert.equal(run('hand.length'), 5);
  assert.equal(run('own[0].length'), 2);
  assert.equal(run('own[1][0].r'), all[19].r);
  assert.equal(run('middle[0].length'), 2);
  assert.equal(run('turns'), 2);
  assert.equal(run('plays'), 3);
  assert.equal(run('turnPlayed'), true);
  assert.deepEqual(Array.from(run('placed')), [true, false, false, false]);
  assert.equal(run('won'), false);
});

test('a completed pile is part of the save', () => {
  const all = allCards();
  setup({
    stack: all.slice(0, 15), drawPile: all.slice(15, 55), hand: all.slice(55, 60),
    completed: 1,
  });
  run('save()');
  run('completed=0; stack=[]; drawPile=[]; hand=[];');
  assert.equal(run('load()'), true);
  assert.equal(run('completed'), 1);
  assert.equal(run('stack.length'), 15);
  assert.equal(run('drawPile.length'), 40);
  assert.equal(run('hand.length'), 5);
});

test('a corrupt or old save is ignored', () => {
  ctx.localStorage.setItem('dreiziehn', '{"stock":[]}');
  assert.equal(run('load()'), false);

  const all = allCards();
  const two = c(2, 0);
  const rest = all.filter(x => cid(x) !== cid(two));
  const bad = {
    stack: rest.slice(0, 15), drawPile: rest.slice(15, 54), hand: rest.slice(54, 59),
    own: [[], [], [], []], middle: [[two], [], [], []],
    completed: 0, placed: [false, false, false, false],
    turnPlayed: false, turns: 0, plays: 0, won: false, undoStack: [],
  };
  ctx.localStorage.setItem('dreiziehn', JSON.stringify(bad));
  assert.equal(run('load()'), false, 'a middle pile must start with 1 or a joker');
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

test('card colours run from blue for 1 to red for 13', () => {
  assert.match(run('cardColor({ r:1, s:0 })'), /hsl\(220/);
  assert.match(run('cardColor({ r:13, s:0 })'), /hsl\(360/);
  assert.match(run('cardColor({ r:0, s:0, j:0 })'), /#b8860b/);
});

test('the middle shows three, caches five and the stack only its top', () => {
  const mid = Array.from({ length: 5 }, (_, i) => c(i + 1, 0));
  const own = Array.from({ length: 7 }, (_, i) => c(i + 1, 1));
  const stack = Array.from({ length: 10 }, (_, i) => c(i + 1, 3));
  setup({ middle: [mid, [], [], []], own: [own, [], [], []], stack });
  assert.equal((ctx.document.getElementById('middle').innerHTML.match(/class="card/g) || []).length, 3);
  assert.equal((ctx.document.getElementById('own').innerHTML.match(/class="card/g) || []).length, 6);
  assert.match(ctx.document.getElementById('own').innerHTML, /Your stack, 10 cards/);
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

test('tapping a cache without a selected card selects its top card', () => {
  setup({ hand: [c(1, 0)], own: [[c(7, 2)], [], [], []] });
  run('tapOwn(0)');
  assert.equal(run('own[0].length'), 1);
  assert.equal(run('hand.length'), 1);
  assert.deepEqual(JSON.parse(run('JSON.stringify(sel)')), { kind: 'own', i: 0 });
  run('tapOwn(0)');
  assert.equal(run('sel'), null);
});

test('tapping the selected card again puts it back', () => {
  setup({ hand: [c(1, 0)] });
  run('tapHand(0)');
  run('tapHand(0)');
  assert.equal(run('sel'), null);

  setup({ stack: [c(1, 0)] });
  run('tapStack()');
  run('tapStack()');
  assert.equal(run('sel'), null);
});

test('the middle pile tells you the next rank', () => {
  assert.equal(run('nextRank([])'), '1');
  assert.equal(run('nextRank([{r:1,s:0}])'), '2');
  assert.equal(run('nextRank(Array.from({length:12},(_,i)=>({r:i+1,s:0})))'), '13');
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

test('a tunneled game uses the lobby on the same origin', () => {
  const saved = ctx.location;
  ctx.location = {
    ...saved,
    href: 'https://abc.trycloudflare.com/games/dreiziehn/dreiziehn.html',
    origin: 'https://abc.trycloudflare.com',
    pathname: '/games/dreiziehn/dreiziehn.html',
    hostname: 'abc.trycloudflare.com',
    protocol: 'https:',
    host: 'abc.trycloudflare.com',
  };
  try {
    assert.equal(run('lobbyBase()'), 'https://abc.trycloudflare.com/lobby/');
    assert.equal(
      run('lobbyUrl(gameUrl())'),
      'https://abc.trycloudflare.com/lobby/?return=https%3A%2F%2Fabc.trycloudflare.com' +
        '%2Fgames%2Fdreiziehn%2Fdreiziehn.html&maxPlayers=4',
    );
    assert.equal(run('defaultLobbyWs()'), 'wss://abc.trycloudflare.com/lobby/ws');
    assert.equal(
      run('safeLobby("wss://abc.trycloudflare.com/lobby/ws")'),
      'wss://abc.trycloudflare.com/lobby/ws',
    );
    assert.equal(run('safeLobby("wss://evil.example/ws")'), '');
  } finally {
    ctx.location = saved;
  }
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
  assert.equal(run('isGameMessage({v:2,type:"state"})'), true);
  assert.equal(run('isGameMessage({v:2,type:"move"})'), true);
  assert.equal(run('isGameMessage({v:1,type:"state"})'), false);
  assert.equal(run('isGameMessage({type:"state"})'), false);
  assert.equal(run('isGameMessage({v:2,type:"nope"})'), false);
  assert.equal(run('isGameMessage(null)'), false);
  assert.equal(run('isGameMessage([])'), false);
});

test('host broadcasts and guest moves use the current game message version', () => {
  const state = {
    turn: 0, winner: null, completed: 0, turnPlayed: false,
    draw: [mc(2)],
    middle: [[], [], [], []],
    players: [
      {
        id: 'h1', name: 'Host', stack: [mc(3)], hand: [mc(0)], own: [[], [], [], []],
        placed: [false, false, false, false],
      },
      {
        id: 'g1', name: 'Guest', stack: [mc(63)], hand: [mc(62)], own: [[], [], [], []],
        placed: [false, false, false, false],
      },
    ],
  };
  run(`
    MP.state=${JSON.stringify(state)}; MP.host=true; MP.socket={readyState:1, send(raw){ globalThis.sent=JSON.parse(raw).data; }};
    mpBroadcast(true);
  `);
  assert.equal(run('sent.v'), 2);
  assert.equal(run('sent.type'), 'state');

  run(`
    MP.host=false; MP.active=true; MP.you='g1'; MP.hostId='h1'; MP.pending=false;
    mpSendMove({kind:'end'});
  `);
  assert.equal(run('sent.v'), 2);
  assert.equal(run('sent.type'), 'move');
});

test('multiplayer state must have a valid shape', () => {
  const good = {
    turn: 0, winner: null, completed: 0, turnPlayed: false,
    draw: [2],
    middle: [[0], [], [], []],
    players: [{
      id: 'h1', name: 'Host', stack: [60], hand: [1], own: [[], [], [], []],
      placed: [false, false, false, false],
    }],
  };
  assert.equal(run(`isMultiState(${JSON.stringify(good)})`), true);
  assert.equal(run(`isMultiState(${JSON.stringify({ ...good, turn: 5 })})`), false);
  assert.equal(run(`isMultiState(${JSON.stringify({ ...good, draw: null })})`), false);
  assert.equal(run(`isMultiState(${JSON.stringify({ ...good, middle: [[1], [], [], []] })})`), false);
  assert.equal(run(`isMultiState(${JSON.stringify({
    ...good, players: [{ ...good.players[0], placed: [false] }],
  })})`), false);
  assert.equal(run('isMultiState(null)'), false);
});

test('the host deals a 15-card stack each and shares the rest in the draw', () => {
  run(`
    MP.active=true; MP.host=true; MP.you='h1'; MP.hostId='h1'; MP.state=null;
    MP.peers=[{id:'h1',name:'Host',host:true,online:true},{id:'g1',name:'Guest',host:false,online:true}];
    mpHostStart(MP.peers);
  `);
  assert.equal(run('MP.state.players.length'), 2);
  assert.equal(run('MP.state.players[0].stack.length'), 15);
  assert.equal(run('MP.state.players[0].hand.length'), 5);
  assert.equal(run('MP.state.players[1].stack.length'), 15);
  assert.equal(run('MP.state.players[1].hand.length'), 5);
  assert.equal(run('MP.state.draw.length'), 80);
  const ids = JSON.parse(run(
    'JSON.stringify([...MP.state.draw, ...MP.state.players.flatMap(p => [...p.stack, ...p.hand])].map(sid))',
  ));
  assert.equal(new Set(ids).size, 120);
});

test('a played 1 lands in the shared middle and serializes for guests', () => {
  const state = {
    turn: 0, winner: null, completed: 0, turnPlayed: false,
    draw: [mc(2), mc(60)],
    middle: [[], [], [], []],
    players: [
      {
        id: 'h1', name: 'Host', stack: [mc(3)], hand: [mc(0)], own: [[], [], [], []],
        placed: [false, false, false, false],
      },
      {
        id: 'g1', name: 'Guest', stack: [mc(63)], hand: [mc(61)], own: [[], [], [], []],
        placed: [false, false, false, false],
      },
    ],
  };
  run(`MP.active=true; MP.host=true; MP.you='h1'; MP.hostId='h1'; MP.meIndex=0; sel=null; MP.pending=false; MP.state=${JSON.stringify(state)};`);
  run('sel={kind:"hand",i:0}; mpTapMiddle(0)');
  assert.equal(run('MP.state.middle[0].length'), 1);
  assert.equal(run('MP.state.middle[0][0].r'), 1);
  assert.equal(run('MP.state.turnPlayed'), true);

  const wire = JSON.parse(run('JSON.stringify(serializeState(MP.state))'));
  assert.deepEqual(wire.middle[0], [0]);
  assert.deepEqual(wire.draw, [2, 60]);
  const guestState = JSON.parse(run(`JSON.stringify(deserializeState(${JSON.stringify(wire)}))`));
  assert.equal(guestState.middle[0][0].r, 1);
  assert.equal(guestState.middle[0][0].s, 0);
  assert.equal(guestState.draw.length, 2);
});

test('a guest renders the shared middle from the host state', () => {
  const hostState = {
    turn: 1, winner: null, completed: 0, turnPlayed: false,
    draw: [mc(2), mc(60)],
    middle: [[mc(0)], [], [], []],
    players: [
      {
        id: 'h1', name: 'Host', stack: [mc(3)], hand: [], own: [[], [], [], []],
        placed: [false, false, false, false],
      },
      {
        id: 'g1', name: 'Guest', stack: [mc(63)], hand: [mc(61)], own: [[], [], [], []],
        placed: [false, false, false, false],
      },
    ],
  };
  const wire = JSON.parse(run(`JSON.stringify(serializeState(${JSON.stringify(hostState)}))`));
  run(`MP.active=true; MP.host=false; MP.you='g1'; MP.hostId='h1'; MP.meIndex=1; MP.state=null;`);
  run(`mpHandleGameMessage('h1', ${JSON.stringify({ v: 2, type: 'state', state: wire })})`);
  assert.equal(run('MP.state.middle[0][0].r'), 1);
  assert.match(ctx.document.getElementById('middle').innerHTML, /1 of spades/);
  assert.equal(ctx.document.getElementById('turnBar').textContent, 'Dein Zug!');
});

test('the host accepts a guest hand move and updates the shared middle', () => {
  const state = {
    turn: 1, winner: null, completed: 0, turnPlayed: false,
    draw: [mc(2), mc(61)],
    middle: [[], [], [], []],
    players: [
      {
        id: 'h1', name: 'Host', stack: [mc(3)], hand: [mc(0)], own: [[], [], [], []],
        placed: [false, false, false, false],
      },
      {
        id: 'g1', name: 'Guest', stack: [mc(63)], hand: [mc(60)], own: [[], [], [], []],
        placed: [false, false, false, false],
      },
    ],
  };
  run(`MP.active=true; MP.host=true; MP.you='h1'; MP.hostId='h1'; MP.meIndex=0; sel=null; MP.pending=false; MP.state=${JSON.stringify(state)};`);
  run(`mpHandleGameMessage('g1', {v:2,type:'move',to:'h1',move:{kind:'middle',from:'hand',card:0,pile:0}})`);
  assert.equal(run('MP.state.middle[0].length'), 1);
  assert.equal(run('MP.state.middle[0][0].r'), 1);
  assert.equal(run('MP.state.players[1].hand.length'), 0);
});

test('multiplayer stack tops and cache tops move up', () => {
  const state = {
    turn: 0, winner: null, completed: 0, turnPlayed: false,
    draw: [],
    middle: [[], [], [], []],
    players: [
      {
        id: 'h1', name: 'Host', stack: [mc(0)], hand: [], own: [[], [], [], []],
        placed: [false, false, false, false],
      },
      {
        id: 'g1', name: 'Guest', stack: [mc(63)], hand: [mc(62)], own: [[], [], [], []],
        placed: [false, false, false, false],
      },
    ],
  };
  run(`MP.active=true; MP.host=true; MP.you='h1'; MP.hostId='h1'; MP.meIndex=0; sel=null; MP.pending=false; MP.state=${JSON.stringify(state)};`);
  run('mpTapStack()');
  assert.equal(run('mpSelectedCard().r'), 1);
  run('mpTapOwn(2)');
  assert.equal(run('MP.state.players[0].stack.length'), 0);
  assert.equal(run('MP.state.players[0].own[2].length'), 1);
  run('mpTapOwn(2)');
  run('mpTapMiddle(0)');
  assert.equal(run('MP.state.players[0].own[2].length'), 0);
  assert.equal(run('MP.state.middle[0][0].r'), 1);
  assert.equal(run('MP.state.winner'), 0, 'stack and caches are now empty');
});

test('the host enforces one hand card per cache each turn', () => {
  const state = {
    turn: 0, winner: null, completed: 0, turnPlayed: false,
    draw: [],
    middle: [[], [], [], []],
    players: [
      {
        id: 'h1', name: 'Host', stack: [], hand: [mc(0), mc(1)], own: [[], [], [], []],
        placed: [false, false, false, false],
      },
      {
        id: 'g1', name: 'Guest', stack: [mc(63)], hand: [mc(62)], own: [[], [], [], []],
        placed: [false, false, false, false],
      },
    ],
  };
  run(`MP.active=true; MP.host=true; MP.you='h1'; MP.hostId='h1'; MP.meIndex=0; sel=null; MP.pending=false; MP.state=${JSON.stringify(state)};`);
  run('mpTapHand(0); mpTapOwn(0)');
  assert.equal(run('MP.state.players[0].placed[0]'), true);
  assert.equal(run('MP.state.players[0].hand.length'), 1);
  run('mpTapHand(0); mpTapOwn(0)');
  assert.equal(run('MP.state.players[0].hand.length'), 1);
  assert.equal(run('MP.state.players[0].own[0].length'), 1);
});

test('a completed middle pile recycles into the shared draw in multiplayer', () => {
  const twelve = Array.from({ length: 12 }, (_, i) => mc(i));
  const state = {
    turn: 0, winner: null, completed: 0, turnPlayed: false,
    draw: [mc(20)],
    middle: [twelve, [], [], []],
    players: [
      {
        id: 'h1', name: 'Host', stack: [], hand: [mc(12)], own: [[], [], [], []],
        placed: [false, false, false, false],
      },
      {
        id: 'g1', name: 'Guest', stack: [mc(63)], hand: [mc(62)], own: [[], [], [], []],
        placed: [false, false, false, false],
      },
    ],
  };
  run(`MP.active=true; MP.host=true; MP.you='h1'; MP.hostId='h1'; MP.meIndex=0; sel=null; MP.pending=false; MP.state=${JSON.stringify(state)};`);
  run('mpTapHand(0); mpTapMiddle(0)');
  assert.equal(run('MP.state.completed'), 1);
  assert.equal(run('MP.state.middle[0].length'), 0);
  assert.equal(run('MP.state.draw.length'), 14);
});

test('ending a turn refills from the shared draw and passes it on', () => {
  const state = {
    turn: 0, winner: null, completed: 0, turnPlayed: true,
    draw: [mc(2), mc(3), mc(4), mc(5), mc(6)],
    middle: [[], [], [], []],
    players: [
      {
        id: 'h1', name: 'Host', stack: [mc(7)], hand: [mc(0)], own: [[], [], [], []],
        placed: [true, false, false, false],
      },
      {
        id: 'g1', name: 'Guest', stack: [mc(63)], hand: [mc(61)], own: [[], [], [], []],
        placed: [false, false, false, false],
      },
    ],
  };
  run(`MP.active=true; MP.host=true; MP.you='h1'; MP.hostId='h1'; MP.meIndex=0; sel=null; MP.pending=false; MP.state=${JSON.stringify(state)};`);
  run('mpApplyHost({kind:"end"})');
  assert.equal(run('MP.state.players[0].hand.length'), 5);
  assert.equal(run('MP.state.players[0].stack.length'), 1);
  assert.equal(run('MP.state.draw.length'), 1);
  assert.deepEqual(Array.from(run('MP.state.players[0].placed')),
    [false, false, false, false]);
  assert.equal(run('MP.state.turn'), 1);
  assert.equal(run('MP.state.turnPlayed'), false);
  assert.equal(run('mpIsMyTurn()'), false);
});

test('a player with an empty stack and caches wins by playing a card', () => {
  const state = {
    turn: 0, winner: null, completed: 0, turnPlayed: false,
    draw: [mc(2)],
    middle: [[], [], [], []],
    players: [
      {
        id: 'h1', name: 'Host', stack: [], hand: [mc(0)], own: [[], [], [], []],
        placed: [false, false, false, false],
      },
      {
        id: 'g1', name: 'Guest', stack: [mc(63)], hand: [mc(61)], own: [[], [], [], []],
        placed: [false, false, false, false],
      },
    ],
  };
  run(`MP.active=true; MP.host=true; MP.you='h1'; MP.hostId='h1'; MP.meIndex=0; sel=null; MP.pending=false; MP.state=${JSON.stringify(state)};`);
  run('sel={kind:"hand",i:0}; mpTapMiddle(0)');
  assert.equal(run('MP.state.winner'), 0);
  assert.match(ctx.document.getElementById('winTitle').textContent, /Dreiziehn/);
});

test('drawing cards from the shared draw does not decide the win', () => {
  const state = {
    turn: 0, winner: null, completed: 0, turnPlayed: true,
    draw: [mc(2)],
    middle: [[], [], [], []],
    players: [
      {
        id: 'h1', name: 'Host', stack: [mc(7)], hand: [], own: [[], [], [], []],
        placed: [false, false, false, false],
      },
      {
        id: 'g1', name: 'Guest', stack: [mc(63)], hand: [mc(61)], own: [[], [], [], []],
        placed: [false, false, false, false],
      },
    ],
  };
  run(`MP.active=true; MP.host=true; MP.you='h1'; MP.hostId='h1'; MP.meIndex=0; sel=null; MP.pending=false; MP.state=${JSON.stringify(state)};`);
  run('mpApplyHost({kind:"end"})');
  assert.equal(run('MP.state.players[0].hand.length'), 1);
  assert.equal(run('MP.state.draw.length'), 0);
  assert.equal(run('MP.state.players[0].stack.length'), 1);
  assert.equal(run('MP.state.winner'), null);
});

test('the host can remove a player and the turn adjusts', () => {
  const state = {
    turn: 1, winner: null, completed: 0, turnPlayed: true,
    draw: [mc(2)],
    middle: [[], [], [], []],
    players: [
      {
        id: 'h1', name: 'Host', stack: [mc(3)], hand: [mc(0)], own: [[], [], [], []],
        placed: [false, false, false, false],
      },
      {
        id: 'g1', name: 'Guest', stack: [mc(60)], hand: [mc(61)], own: [[], [], [], []],
        placed: [false, false, false, false],
      },
      {
        id: 'g2', name: 'Other', stack: [mc(120)], hand: [mc(121)], own: [[], [], [], []],
        placed: [false, false, false, false],
      },
    ],
  };
  run(`MP.active=true; MP.host=true; MP.you='h1'; MP.hostId='h1'; MP.meIndex=0; sel=null; MP.pending=false; MP.state=${JSON.stringify(state)};`);
  run(`mpRemovePlayer('g1')`);
  assert.equal(run('MP.state.players.length'), 2);
  assert.equal(run('MP.state.players.map(p => p.id).join(",")'), 'h1,g2');
  assert.equal(run('MP.state.turn'), 1);
  assert.equal(run('MP.state.turnPlayed'), false);
});

test('a removed player sees the removal overlay', () => {
  const state = {
    turn: 0, winner: null, completed: 0, turnPlayed: false,
    draw: [mc(2)],
    middle: [[], [], [], []],
    players: [
      {
        id: 'h1', name: 'Host', stack: [mc(3)], hand: [mc(0)], own: [[], [], [], []],
        placed: [false, false, false, false],
      },
      {
        id: 'g2', name: 'Other', stack: [mc(120)], hand: [mc(121)], own: [[], [], [], []],
        placed: [false, false, false, false],
      },
    ],
  };
  run(`MP.active=true; MP.host=false; MP.you='g1'; MP.hostId='h1'; MP.meIndex=-1; MP.state=${JSON.stringify(state)}; drawMulti();`);
  assert.equal(ctx.document.getElementById('turnBar').textContent, 'Du bist nicht mehr im Spiel.');
  assert.equal(ctx.document.getElementById('winTitle').textContent, 'Entfernt');
});
