import { solve } from './hashcash.js';
import { safeReturn } from './return-url.js';

const $ = (id) => document.getElementById(id);
const nameInput = $('name');
const roomInput = $('room');
nameInput.value = localStorage.getItem('lobby-name') ?? '';
nameInput.addEventListener('input', () => localStorage.setItem('lobby-name', nameInput.value));

const params = new URLSearchParams(location.search);
const roomParam = params.get('room');
const invitedBy = (params.get('by') ?? '').trim().slice(0, 24);
const gameName = (params.get('game') ?? '').trim().slice(0, 40);
const de = (navigator.language ?? '').toLowerCase().startsWith('de');
const ui = de ? {
  name: 'Dein Name',
  room: 'Raumname',
  roomPlaceholder: 'z. B. acid-acorn-acre',
  join: 'Spiel Beitreten',
  create: 'Neue Spieleinladung',
  roomRequired: 'Bitte einen Raumnamen eingeben.',
  mode: 'Spielart',
  live: 'Live – beide gleichzeitig online',
  postbox: 'Langzeit – 7 Tage, Zug für Zug',
  ongoing: 'Deine Spiele',
  resume: 'Weiterspielen',
  forget: 'Entfernen',
} : {
  name: 'Your name',
  room: 'Room name',
  roomPlaceholder: 'e.g. acid-acorn-acre',
  join: 'Join Game',
  create: 'New lobby',
  roomRequired: 'Enter a room name.',
  mode: 'Game type',
  live: 'Live – both online at once',
  postbox: 'Long game – 7 days, turn by turn',
  ongoing: 'Your games',
  resume: 'Resume',
  forget: 'Forget',
};

$('nameLabel').textContent = ui.name;
$('roomLabel').textContent = ui.room;
roomInput.placeholder = ui.roomPlaceholder;
$('joinButton').textContent = ui.join;
$('create').textContent = ui.create;
$('modeLabel').textContent = ui.mode;
$('mode').options[0].textContent = ui.live;
$('mode').options[1].textContent = ui.postbox;
$('ongoingTitle').textContent = ui.ongoing;
document.documentElement.lang = de ? 'de' : 'en';

let ws = null;
let roomId = null;
let token = null;
let host = false;
let started = false;
let playerName = '';
let roomMode = 'live';
let pendingRoom = null;

let returnUrl = safeReturn(params.get('return'), location.origin);
let maxPlayers = Math.max(1, Math.min(12, Number.parseInt(
  params.get('maxPlayers'), 10) || 12));

const basePath = location.pathname.replace(/[^/]*$/, '');
const endpoint = (path) => new URL(path, location.origin + basePath).href;
const wsUrl = () => {
  const url = new URL('ws', location.origin + basePath);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  return url.href;
};

const tokenStore = (id) => `lobby-token:${id}`;
const ROOMS_KEY = 'lobby-rooms';
const readRooms = () => {
  try {
    const all = JSON.parse(localStorage.getItem(ROOMS_KEY) ?? '{}');
    return all && typeof all === 'object' && !Array.isArray(all) ? all : {};
  } catch {
    return {};
  }
};
const writeRooms = (all) => {
  try { localStorage.setItem(ROOMS_KEY, JSON.stringify(all)); } catch { /* storage unavailable */ }
};
const remember = (entry) => {
  const all = readRooms();
  all[entry.room] = { ...all[entry.room], ...entry, seen: Date.now() };
  writeRooms(all);
};
const forget = (id) => {
  const all = readRooms();
  delete all[id];
  writeRooms(all);
};
const roomLabel = (entry) => {
  const kind = entry.mode === 'postbox' ? 'long game' : 'live';
  const state = entry.started ? 'started' : 'waiting';
  const when = new Date(entry.seen || 0).toLocaleDateString();
  return `${entry.game || 'Game'} · ${entry.room} · ${kind} · ${state} · ${when}`;
};
const renderOngoing = () => {
  const now = Date.now();
  const all = readRooms();
  let changed = false;
  for (const [id, entry] of Object.entries(all)) {
    if (!entry.seen || now - entry.seen > 8 * 24 * 3600e3) {
      delete all[id];
      changed = true;
    }
  }
  if (changed) writeRooms(all);
  const entries = Object.values(all).sort((a, b) => (b.seen || 0) - (a.seen || 0));
  $('ongoing').hidden = !entries.length;
  $('ongoingList').replaceChildren(...entries.map((entry) => {
    const li = document.createElement('li');
    const label = document.createElement('span');
    label.textContent = roomLabel(entry);
    const resume = document.createElement('button');
    resume.type = 'button';
    resume.textContent = ui.resume;
    resume.addEventListener('click', () => joinRoom(entry.room));
    const forgetButton = document.createElement('button');
    forgetButton.type = 'button';
    forgetButton.className = 'quiet';
    forgetButton.textContent = ui.forget;
    forgetButton.addEventListener('click', () => {
      localStorage.removeItem(tokenStore(entry.room));
      forget(entry.room);
      renderOngoing();
    });
    li.append(label, resume, forgetButton);
    return li;
  }));
};

const joinUrl = (id) => {
  const url = new URL(`${location.origin}${basePath}`);
  url.searchParams.set('room', id);
  if (playerName) url.searchParams.set('by', playerName);
  if (gameName) url.searchParams.set('game', gameName);
  return url.href;
};
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

const STICK = '<svg class="stick" viewBox="0 0 24 32" aria-hidden="true">' +
  '<circle cx="12" cy="6" r="3.4"/>' +
  '<path d="M12 9.5V20M12 12.5l-5.5 4M12 12.5l5.5 4M12 20l-4.5 8M12 20l4.5 8"/>' +
  '</svg>';

function seatElement(player) {
  const seat = document.createElement('div');
  seat.className = 'seat' + (player ? '' : ' empty') + (player?.online === false ? ' offline' : '');
  const figure = document.createElement('span');
  figure.className = 'seat-figure';
  figure.innerHTML = STICK;
  const name = document.createElement('span');
  name.className = 'seat-name';

  if (!player) {
    name.textContent = de ? 'frei' : 'free';
    seat.setAttribute('aria-label', de ? 'Freier Platz' : 'Empty seat');
    seat.append(figure, name);
    return seat;
  }

  name.textContent = player.name;
  seat.title = player.name + (player.host ? ' (Host)' : '') + (player.online ? '' : ' – offline');
  seat.setAttribute('aria-label', seat.title);
  seat.append(figure, name);

  if (player.host) {
    const mark = document.createElement('span');
    mark.className = 'seat-host';
    mark.textContent = '★';
    mark.title = 'Host';
    mark.setAttribute('aria-hidden', 'true');
    seat.append(mark);
  }
  if (!player.online) {
    const away = document.createElement('span');
    away.className = 'seat-away';
    away.textContent = 'offline';
    seat.append(away);
  }
  if (host && !player.host) {
    const remove = document.createElement('button');
    remove.className = 'seat-kick';
    remove.textContent = '×';
    remove.title = `${de ? 'Entfernen' : 'Remove'}: ${player.name}`;
    remove.setAttribute('aria-label', remove.title);
    remove.addEventListener('click', () => send({ t: 'kick', id: player.id }));
    seat.append(remove);
  }
  return seat;
}

function furnitureElement(kind, seats) {
  const piece = document.createElement('div');
  piece.className = `furniture ${kind}`;
  piece.setAttribute('role', 'list');
  for (const player of seats) {
    const seat = seatElement(player);
    seat.setAttribute('role', 'listitem');
    piece.append(seat);
  }
  return piece;
}

function buildFurniture(seats) {
  if (!seats.length) return [];
  const add = (kind, group) =>
    ({ el: furnitureElement(kind, group), seats: group.length });
  // One chair is always present; sofas appear only once a full group of four is left.
  const pieces = [add('chair', [seats[0]])];
  const rest = seats.slice(1);
  let i = 0;
  for (; rest.length - i >= 4; i += 4) pieces.push(add('sofa', rest.slice(i, i + 4)));
  for (; i < rest.length; i += 1) pieces.push(add('chair', [rest[i]]));
  return pieces;
}

function renderPeers(peers) {
  $('peerCount').textContent = `Teilnehmer: ${peers.length} / ${maxPlayers}`;
  const seats = Array.from(
    { length: Math.max(maxPlayers, peers.length) },
    (_, i) => peers[i] ?? null,
  );
  const top = [];
  const bottom = [];
  let topSeats = 0;
  let bottomSeats = 0;
  for (const piece of buildFurniture(seats)) {
    if (topSeats <= bottomSeats) {
      top.push(piece.el);
      topSeats += piece.seats;
    } else {
      bottom.push(piece.el);
      bottomSeats += piece.seats;
    }
  }
  $('seatTop').replaceChildren(...top);
  $('seatBottom').replaceChildren(...bottom);

  const hostPeer = peers.find((p) => p.host);
  const waiting = !host && !started && hostPeer
    ? (de
      ? `Warte auf „${hostPeer.name}“, um das Spiel zu starten.`
      : `Waiting for ${hostPeer.name} to start the game.`)
    : roomMode === 'postbox' && !started && host
      ? (de
        ? 'Langzeit-Spiel: Link teilen, dann starten, sobald jemand beigetreten ist.'
        : 'Long game: share the link, then start once someone has joined.')
      : '';
  $('waiting').textContent = waiting;
  $('waiting').hidden = !waiting;

  $('start').hidden = !(host && !started);
  $('start').disabled = roomMode === 'postbox' && peers.length < 2;
  $('start').textContent = roomMode === 'postbox' ? 'Start long game' : 'Start Game';
}

function onJoined(msg) {
  pendingRoom = null;
  roomId = msg.room;
  token = msg.token;
  host = msg.host;
  started = msg.started;
  roomMode = msg.mode === 'postbox' ? 'postbox' : 'live';
  playerName = msg.name;
  localStorage.setItem('lobby-name', playerName);
  returnUrl = safeReturn(msg.returnUrl, location.origin) || returnUrl;
  maxPlayers = msg.maxPlayers ?? maxPlayers;
  localStorage.setItem(tokenStore(roomId), token);
  remember({
    room: roomId,
    token,
    returnUrl,
    game: gameName,
    mode: roomMode,
    name: playerName,
    started: msg.started,
  });
  renderOngoing();
  const next = new URLSearchParams({ room: roomId });
  if (gameName) next.set('game', gameName);
  history.replaceState(null, '', `?${next}`);

  $('home').hidden = true;
  $('lobby').hidden = false;
  $('roomId').textContent = roomId;
  const link = joinUrl(roomId);
  $('link').textContent = link;
  $('link').href = link;
  $('qrBox').hidden = true;
  $('qr').removeAttribute('src');
  $('lobbyStatus').textContent = roomMode === 'postbox'
    ? (de ? 'Langzeit-Spiel: dieser Link gilt 7 Tage.' : 'Long game: this link stays valid for 7 days.')
    : '';
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
    mode: roomMode,
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
  waiting: 'Lade zuerst eine zweite Person ein.',
  stale: 'Der Spielstand ist bereits weiter. Lade neu.',
  'live-room': 'Das ist kein Langzeit-Raum.',
  'bad-state': 'Ungültiger Spielstand.',
  'room-timeout': 'Raum abgelaufen (maximale Laufzeit erreicht).',
  'idle-timeout': 'Raum wegen Inaktivität geschlossen.',
  removed: 'Der Host hat dich aus dem Raum entfernt.',
};

function onError(msg) {
  const text = errorText[msg.code] ?? `Fehler: ${msg.code}`;
  $('status').textContent = text;
  $('lobbyStatus').textContent = text;
  $('gameStatus').textContent = text;
  if (['no-room', 'room-timeout', 'idle-timeout', 'live-room', 'closed'].includes(msg.code)) {
    const stale = roomId || pendingRoom;
    if (stale) {
      localStorage.removeItem(tokenStore(stale));
      forget(stale);
      renderOngoing();
    }
    pendingRoom = null;
  }
  if (!roomId) {
    $('lobby').hidden = true;
    $('game').hidden = true;
    $('home').hidden = false;
  }
}

function onClosed(reason) {
  onError({ code: reason });
  if (roomId) {
    localStorage.removeItem(tokenStore(roomId));
    forget(roomId);
    renderOngoing();
  }
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
      if (roomId) {
        remember({ room: roomId, started });
        renderOngoing();
      }
      return renderPeers(msg.peers);
    case 'started':
      if (roomId) {
        remember({ room: roomId, started: true });
        renderOngoing();
      }
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
  pendingRoom = null;
  const mode = $('mode').value === 'postbox' ? 'postbox' : 'live';
  $('status').textContent = 'Challenge anfordern …';
  try {
    const { challenge, bits } = await (await fetch(endpoint(`challenge?mode=${mode}`))).json();
    const start = performance.now();
    const proof = await solve(challenge, bits, (tries) => {
      $('status').textContent = `Hashcash: ${bits} Bits, ${tries.toLocaleString('de-DE')} Versuche …`;
    });
    $('status').textContent = `Hashcash gelöst in ${((performance.now() - start) / 1000).toFixed(1)} s`;
    connect(() => send({ t: 'create', proof, name: nameInput.value, returnUrl, maxPlayers, mode }));
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


function joinRoom(room) {
  const saved = readRooms()[room];
  pendingRoom = room;
  roomMode = saved?.mode === 'postbox' ? 'postbox' : 'live';
  $('home').hidden = true;
  $('lobby').hidden = false;
  $('lobbyStatus').textContent = 'Verbinde …';
  connect(() =>
    send({
      t: 'join',
      room,
      token: localStorage.getItem(tokenStore(room)) || saved?.token || null,
      name: nameInput.value,
    }),
  );
}

$('joinForm').addEventListener('submit', (event) => {
  event.preventDefault();
  const room = roomInput.value.trim().toLowerCase().replace(/\s+/g, '-');
  if (!room) return ($('status').textContent = ui.roomRequired);
  joinRoom(room);
});

if (roomParam) {
  roomInput.value = roomParam;
  const invited = invitedBy && gameName
    ? (de ? `${invitedBy} hat dich zu „${gameName}“ eingeladen.` : `${invitedBy} invited you to play “${gameName}”.`)
    : invitedBy
      ? (de ? `${invitedBy} hat dich zu einem Spiel eingeladen.` : `${invitedBy} invited you to a game.`)
      : gameName
        ? (de ? `Du wurdest zu „${gameName}“ eingeladen.` : `You were invited to play “${gameName}”.`)
        : '';
  if (invited) {
    $('invite').textContent = invited;
    $('invite').hidden = false;
  }
}

if (roomParam && (localStorage.getItem(tokenStore(roomParam)) || readRooms()[roomParam]?.token)) {
  joinRoom(roomParam);
}

renderOngoing();
