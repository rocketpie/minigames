import { solve } from './hashcash.js';

const $ = (id) => document.getElementById(id);
const nameInput = $('name');
nameInput.value = localStorage.getItem('lobby-name') ?? '';
nameInput.addEventListener('change', () => localStorage.setItem('lobby-name', nameInput.value));

let ws = null;
let roomId = null;
let token = null;
let host = false;
let started = false;

const tokenStore = (id) => `lobby-token:${id}`;
const joinUrl = (id) => `${location.origin}${location.pathname}?room=${id}`;
const send = (msg) => ws.send(JSON.stringify(msg));

const log = (text) => {
  const li = document.createElement('li');
  li.textContent = text;
  $('log').append(li);
  $('log').scrollTop = $('log').scrollHeight;
};

function connect(onOpen) {
  ws?.close();
  ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`);
  ws.addEventListener('open', onOpen);
  ws.addEventListener('message', (event) => handle(JSON.parse(event.data)));
  ws.addEventListener('close', () => {
    if (!roomId) return;
    $('lobbyStatus').textContent = 'Verbindung getrennt. Seite neu laden, um wieder beizutreten.';
    $('gameStatus').textContent = 'Verbindung getrennt.';
  });
}

function renderPeers(peers) {
  $('peers').replaceChildren(
    ...peers.map((p) => {
      const li = document.createElement('li');
      li.textContent = p.name + (p.host ? ' (Host)' : '') + (p.online ? '' : ' – offline');
      return li;
    }),
  );
  $('start').hidden = !(host && !started);
}

function onJoined(msg) {
  roomId = msg.room;
  token = msg.token;
  host = msg.host;
  started = msg.started;
  sessionStorage.setItem(tokenStore(roomId), token);
  history.replaceState(null, '', `?room=${roomId}`);

  $('home').hidden = true;
  $('lobby').hidden = false;
  $('roomId').textContent = roomId;
  const link = joinUrl(roomId);
  $('link').textContent = link;
  $('link').href = link;
  $('qrBox').hidden = true;
  $('qr').removeAttribute('src');
  $('lobbyStatus').textContent = '';
  renderPeers(msg.peers);
  if (started) showGame();
}

function showGame() {
  started = true;
  $('lobby').hidden = true;
  $('game').hidden = false;
  $('gameRoom').textContent = roomId;
}

const errorText = {
  'no-room': 'Raum existiert nicht (mehr) oder ist abgelaufen. Erstelle einen neuen.',
  closed: 'Das Spiel läuft bereits, ein Beitritt ist nicht mehr möglich.',
  full: 'Der Raum ist voll.',
  'rate-limit': 'Zu viele Daten gesendet – Nachricht verworfen.',
  'bad-proof': 'Hashcash ungültig, bitte nochmal erstellen.',
  lobby: 'Das Spiel wurde noch nicht gestartet.',
  forbidden: 'Das darf nur der Host.',
  'not-joined': 'Nicht im Raum.',
  'room-timeout': 'Raum abgelaufen (maximale Laufzeit erreicht).',
  'idle-timeout': 'Raum wegen Inaktivität geschlossen.',
};

function onError(msg) {
  const text = errorText[msg.code] ?? `Fehler: ${msg.code}`;
  $('status').textContent = text;
  $('lobbyStatus').textContent = text;
  $('gameStatus').textContent = text;
  if (!roomId) {
    $('lobby').hidden = true;
    $('game').hidden = true;
    $('home').hidden = false;
  }
}

function onClosed(reason) {
  onError({ code: reason });
  roomId = null;
  $('lobby').hidden = true;
  $('game').hidden = true;
  $('home').hidden = false;
}

function handle(msg) {
  switch (msg.t) {
    case 'joined':
      return onJoined(msg);
    case 'peers':
      started = msg.started;
      return renderPeers(msg.peers);
    case 'started':
      return showGame();
    case 'msg':
      return log(`${msg.name}: ${msg.data?.text ?? JSON.stringify(msg.data)}`);
    case 'error':
      return onError(msg);
    case 'closed':
      return onClosed(msg.reason);
  }
}

$('create').addEventListener('click', async () => {
  $('create').disabled = true;
  $('status').textContent = 'Challenge anfordern …';
  try {
    const { challenge, bits } = await (await fetch('/challenge')).json();
    const start = performance.now();
    const proof = await solve(challenge, bits, (tries) => {
      $('status').textContent = `Hashcash: ${bits} Bits, ${tries.toLocaleString('de-DE')} Versuche …`;
    });
    $('status').textContent = `Hashcash gelöst in ${((performance.now() - start) / 1000).toFixed(1)} s`;
    connect(() => send({ t: 'create', proof, name: nameInput.value }));
  } catch (err) {
    $('status').textContent = `Fehler: ${err.message}`;
  } finally {
    $('create').disabled = false;
  }
});

$('copy').addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(joinUrl(roomId));
    $('copy').textContent = 'Kopiert!';
  } catch {
    $('lobbyStatus').textContent = 'Kopieren nicht erlaubt – Link oben markieren.';
  }
  setTimeout(() => ($('copy').textContent = 'Link kopieren'), 1500);
});

$('showQr').addEventListener('click', () => {
  const box = $('qrBox');
  box.hidden = !box.hidden;
  if (!box.hidden) $('qr').src = `/qr?text=${encodeURIComponent(joinUrl(roomId))}`;
});

$('start').addEventListener('click', () => send({ t: 'start' }));

$('say').addEventListener('submit', (event) => {
  event.preventDefault();
  const text = $('sayText').value.trim();
  if (!text) return;
  send({ t: 'msg', data: { text } });
  $('sayText').value = '';
});

const roomParam = new URLSearchParams(location.search).get('room');
if (roomParam) {
  $('home').hidden = true;
  $('lobby').hidden = false;
  $('lobbyStatus').textContent = 'Verbinde …';
  connect(() =>
    send({
      t: 'join',
      room: roomParam,
      token: sessionStorage.getItem(tokenStore(roomParam)),
      name: nameInput.value,
    }),
  );
}
