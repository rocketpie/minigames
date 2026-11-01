import { solve } from './hashcash.js';
import { safeReturn } from './return-url.js';

const $ = (id) => document.getElementById(id);
const nameInput = $('name');
const roomInput = $('room');
nameInput.value = localStorage.getItem('lobby-name') ?? '';
nameInput.addEventListener('change', () => localStorage.setItem('lobby-name', nameInput.value));

let ws = null;
let roomId = null;
let token = null;
let host = false;
let started = false;
let playerName = '';

let returnUrl = safeReturn(new URLSearchParams(location.search).get('return'), location.origin);
let maxPlayers = Math.max(1, Math.min(12, Number.parseInt(
  new URLSearchParams(location.search).get('maxPlayers'), 10) || 12));

const basePath = location.pathname.replace(/[^/]*$/, '');
const endpoint = (path) => new URL(path, location.origin + basePath).href;
const wsUrl = () => {
  const url = new URL('ws', location.origin + basePath);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  return url.href;
};

const tokenStore = (id) => `lobby-token:${id}`;
const joinUrl = (id) => `${location.origin}${basePath}?room=${id}`;
const send = (msg) => ws.send(JSON.stringify(msg));

const log = (text) => {
  const li = document.createElement('li');
  li.textContent = text;
  $('log').append(li);
  $('log').scrollTop = $('log').scrollHeight;
};

function connect(onOpen) {
  ws?.close();
  ws = new WebSocket(wsUrl());
  ws.addEventListener('open', onOpen);
  ws.addEventListener('message', (event) => handle(JSON.parse(event.data)));
  ws.addEventListener('close', () => {
    if (!roomId) return;
    $('lobbyStatus').textContent = 'Verbindung getrennt. Seite neu laden, um wieder beizutreten.';
    $('gameStatus').textContent = 'Verbindung getrennt.';
  });
}

function renderPeers(peers) {
  $('peerCount').textContent = `Teilnehmer: ${peers.length} / ${maxPlayers}`;
  $('peers').replaceChildren(
    ...peers.map((p) => {
      const li = document.createElement('li');
      li.textContent = p.name + (p.host ? ' (Host)' : '') + (p.online ? ' – online' : ' – offline');
      if (host && !p.host) {
        const remove = document.createElement('button');
        remove.textContent = 'Entfernen';
        remove.addEventListener('click', () => send({ t: 'kick', id: p.id }));
        li.append(remove);
      }
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
  playerName = msg.name;
  returnUrl = safeReturn(msg.returnUrl, location.origin) || returnUrl;
  maxPlayers = msg.maxPlayers ?? maxPlayers;
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
  if (started) openGame();
}

function showPlaceholder() {
  started = true;
  $('lobby').hidden = true;
  $('game').hidden = false;
  $('gameRoom').textContent = roomId;
}

function openGame() {
  started = true;
  if (!returnUrl) return showPlaceholder();

  const url = new URL(returnUrl);
  url.searchParams.set('room', roomId);
  url.hash = new URLSearchParams({
    token,
    name: playerName,
    lobby: wsUrl(),
  }).toString();
  location.replace(url.toString());
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
  removed: 'Der Host hat dich aus dem Raum entfernt.',
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
  if (roomId) sessionStorage.removeItem(tokenStore(roomId));
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
      maxPlayers = msg.maxPlayers ?? maxPlayers;
      return renderPeers(msg.peers);
    case 'started':
      return openGame();
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
    const { challenge, bits } = await (await fetch(endpoint('challenge'))).json();
    const start = performance.now();
    const proof = await solve(challenge, bits, (tries) => {
      $('status').textContent = `Hashcash: ${bits} Bits, ${tries.toLocaleString('de-DE')} Versuche …`;
    });
    $('status').textContent = `Hashcash gelöst in ${((performance.now() - start) / 1000).toFixed(1)} s`;
    connect(() => send({ t: 'create', proof, name: nameInput.value, returnUrl, maxPlayers }));
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
  if (!box.hidden) $('qr').src = endpoint(`qr?text=${encodeURIComponent(joinUrl(roomId))}`);
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

function joinRoom(room) {
  $('home').hidden = true;
  $('lobby').hidden = false;
  $('lobbyStatus').textContent = 'Verbinde …';
  connect(() =>
    send({
      t: 'join',
      room,
      token: sessionStorage.getItem(tokenStore(room)),
      name: nameInput.value,
    }),
  );
}

$('joinForm').addEventListener('submit', (event) => {
  event.preventDefault();
  const room = roomInput.value.trim().toLowerCase().replace(/\s+/g, '-');
  if (!room) return ($('status').textContent = 'Bitte einen Raumname eingeben.');
  joinRoom(room);
});

if (roomParam && sessionStorage.getItem(tokenStore(roomParam))) {
  joinRoom(roomParam);
} else if (roomParam) {
  roomInput.value = roomParam;
  $('status').textContent = `Raum: ${roomParam}`;
}
