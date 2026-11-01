import test from 'node:test';
import assert from 'node:assert/strict';
import { WebSocket as WsClient } from 'ws';
import { startServer } from './server.mjs';
import { solve } from './public/hashcash.js';

function connect(url) {
  const ws = new WebSocket(url);
  const inbox = [];
  const waiting = [];
  const open = new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true });
    ws.addEventListener('error', reject, { once: true });
  });
  ws.addEventListener('message', (event) => {
    const msg = JSON.parse(event.data);
    const index = waiting.findIndex((w) => w.match(msg));
    if (index >= 0) waiting.splice(index, 1)[0].resolve(msg);
    else inbox.push(msg);
  });
  return {
    ws,
    open,
    send: (msg) => ws.send(JSON.stringify(msg)),
    next: (match) =>
      new Promise((resolve, reject) => {
        const test = typeof match === 'string' ? (m) => m.t === match : match;
        const index = inbox.findIndex(test);
        if (index >= 0) return resolve(inbox.splice(index, 1)[0]);
        const timer = setTimeout(() => reject(new Error('timeout waiting for message')), 3000);
        waiting.push({ match: test, resolve: (msg) => (clearTimeout(timer), resolve(msg)) });
      }),
  };
}

test('static files, challenge, QR and the full room flow', async (t) => {
  const server = await startServer({ port: 0, host: '127.0.0.1', hashcashBits: 8, sweepMs: 60_000 });
  t.after(() => server.close());
  const wsUrl = `${server.url.replace('http', 'ws')}/ws`;

  assert.equal((await fetch(`${server.url}/healthz`)).status, 200);
  const home = await fetch(`${server.url}/`);
  assert.match(await home.text(), /Lobby/);
  assert.equal(home.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(home.headers.get('referrer-policy'), 'no-referrer');
  assert.match(home.headers.get('content-security-policy'), /frame-ancestors 'none'/);
  const guide = await fetch(`${server.url}/guide.html`);
  assert.equal(guide.status, 200);
  assert.match(await guide.text(), /Integration guide/);
  const qr = await fetch(`${server.url}/qr?text=${encodeURIComponent('https://example.test/?room=1')}`);
  assert.equal(qr.headers.get('content-type'), 'image/svg+xml');
  assert.match(await qr.text(), /<svg/);

  const { challenge, bits } = await (await fetch(`${server.url}/challenge`)).json();
  const host = connect(wsUrl);
  await host.open;
  const returnUrl = 'https://co3d.eu/dreiziehn/dreiziehn.html';
  host.send({ t: 'create', proof: await solve(challenge, bits), name: 'Ada', returnUrl, maxPlayers: 2 });
  const h = await host.next('joined');
  assert.equal(h.host, true);
  assert.equal(h.started, false);
  assert.equal(h.returnUrl, returnUrl);
  assert.equal(h.maxPlayers, 2);
  assert.equal(h.peers.length, 1);

  const guest = connect(wsUrl);
  await guest.open;
  guest.send({ t: 'join', room: h.room, token: null, name: 'Bob' });
  const g = await guest.next('joined');
  assert.notEqual(g.you, h.you);
  assert.equal(g.returnUrl, returnUrl);
  assert.equal(g.maxPlayers, 2);
  await host.next((m) => m.t === 'peers' && m.peers.length === 2);

  const extra = connect(wsUrl);
  await extra.open;
  extra.send({ t: 'join', room: h.room, name: 'Cara' });
  assert.equal((await extra.next('error')).code, 'full');
  extra.ws.close();

  host.send({ t: 'start' });
  await guest.next('started');
  guest.send({ t: 'msg', data: { text: 'hi' } });
  const relayed = await host.next('msg');
  assert.deepEqual(relayed.data, { text: 'hi' });
  assert.equal(relayed.name, 'Bob');

  const late = connect(wsUrl);
  await late.open;
  late.send({ t: 'join', room: h.room, name: 'Eve' });
  assert.equal((await late.next('error')).code, 'closed');

  guest.ws.close();
  const back = connect(wsUrl);
  await back.open;
  back.send({ t: 'join', room: h.room, token: g.token, name: 'Bob' });
  const rejoined = await back.next('joined');
  assert.equal(rejoined.host, false);
  assert.equal(rejoined.peers.length, 2);

  host.send({ t: 'kick', id: rejoined.you });
  assert.equal((await back.next('closed')).reason, 'removed');
  const afterKick = await host.next((m) => m.t === 'peers' && m.peers.length === 1);
  assert.equal(afterKick.peers[0].name, 'Ada');
});

test('room creation without work is rejected', async (t) => {
  const server = await startServer({ port: 0, host: '127.0.0.1', hashcashBits: 12, sweepMs: 60_000 });
  t.after(() => server.close());
  const { challenge } = await (await fetch(`${server.url}/challenge`)).json();
  const client = connect(`${server.url.replace('http', 'ws')}/ws`);
  await client.open;
  client.send({ t: 'create', proof: `${challenge}:0` });
  assert.equal((await client.next('error')).code, 'bad-proof');
});

test('websocket origins are checked when the browser sends one', async (t) => {
  const server = await startServer({
    port: 0, host: '127.0.0.1', hashcashBits: 8, sweepMs: 60_000,
    allowedOrigins: ['https://co3d.eu'],
  });
  t.after(() => server.close());
  const url = `${server.url.replace('http', 'ws')}/ws`;

  const ok = new WsClient(url, { headers: { Origin: 'https://co3d.eu' } });
  await new Promise((resolve, reject) => {
    ok.once('open', resolve);
    ok.once('error', reject);
  });
  ok.close();

  const bad = new WsClient(url, { headers: { Origin: 'https://evil.example' } });
  const outcome = await new Promise((resolve) => {
    bad.once('open', () => resolve('open'));
    bad.once('error', () => resolve('error'));
  });
  assert.equal(outcome, 'error');
});
