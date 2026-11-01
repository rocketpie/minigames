import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import { connect } from 'node:net';
import { fileURLToPath } from 'node:url';
import { startServer } from './serve.mjs';

const root = fileURLToPath(new URL('./games', import.meta.url));

test('the gateway serves games and proxies lobby HTTP and WebSocket', async (t) => {
  const lobby = createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'text/plain' });
    res.end(`lobby ${req.url} host=${req.headers.host}`);
  });
  const upgrades = new Set();
  lobby.on('upgrade', (req, socket) => {
    upgrades.add(socket);
    socket.on('close', () => upgrades.delete(socket));
    const accept = createHash('sha1')
      .update(req.headers['sec-websocket-key'] + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11')
      .digest('base64');
    socket.write(
      'HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n' +
      `Sec-WebSocket-Accept: ${accept}\r\n\r\n`,
    );
  });
  await new Promise((resolve) => lobby.listen(0, '127.0.0.1', resolve));
  t.after(() => {
    for (const socket of upgrades) socket.destroy();
    lobby.closeAllConnections();
    lobby.close();
  });

  const gateway = await startServer({
    port: 0,
    root,
    lobby: `http://127.0.0.1:${lobby.address().port}`,
  });
  t.after(() => {
    gateway.server.closeAllConnections();
    gateway.server.close();
  });

  assert.match(await (await fetch(`${gateway.url}/games/index.html`)).text(), /minigames/);
  const rootRedirect = await fetch(`${gateway.url}/`, { redirect: 'manual' });
  assert.equal(rootRedirect.status, 302);
  assert.equal(rootRedirect.headers.get('location'), '/games/');
  assert.equal((await fetch(`${gateway.url}/freecell/freecell.html`)).status, 404);
  assert.equal((await fetch(`${gateway.url}/challenge`)).status, 404);

  const host = new URL(gateway.url).host;
  assert.equal(await (await fetch(`${gateway.url}/lobby/`)).text(), `lobby / host=${host}`);
  assert.equal(
    await (await fetch(`${gateway.url}/lobby/app.js?x=1`)).text(),
    `lobby /app.js?x=1 host=${host}`,
  );
  assert.equal(
    await (await fetch(`${gateway.url}/lobby/challenge`)).text(),
    `lobby /challenge host=${host}`,
  );

  const redirect = await fetch(`${gateway.url}/lobby`, { redirect: 'manual' });
  assert.equal(redirect.status, 302);
  assert.equal(redirect.headers.get('location'), '/lobby/');

  const key = randomBytes(16).toString('base64');
  const response = await new Promise((resolve, reject) => {
    const socket = connect(new URL(gateway.url).port, '127.0.0.1', () => {
      socket.write(
        `GET /lobby/ws HTTP/1.1\r\nHost: ${host}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n` +
        `Sec-WebSocket-Key: ${key}\r\nSec-WebSocket-Version: 13\r\n\r\n`,
      );
    });
    let text = '';
    socket.on('data', (chunk) => {
      text += chunk;
      if (!text.includes('\r\n\r\n')) return;
      socket.destroy();
      resolve(text);
    });
    socket.on('error', reject);
  });
  assert.match(response, /^HTTP\/1\.1 101 /);
  assert.match(response, /Sec-WebSocket-Accept: /);
});
