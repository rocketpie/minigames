// Lobby server: static files, hashcash challenge, QR helper, WebSocket relay.
// The server only knows room codes and forwards messages; game rules stay in the browser.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { WebSocketServer } from 'ws';
import QRCode from 'qrcode';
import { Relay } from './relay.mjs';

const publicDir = join(fileURLToPath(new URL('.', import.meta.url)), 'public');
const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
};

const envNum = (key, fallback) => (process.env[key] ? Number(process.env[key]) : fallback);
const send = (ws, msg) => {
  if (ws && ws.readyState === 1) ws.send(JSON.stringify(msg));
};

export async function startServer(options = {}) {
  const relay = new Relay({
    hashcashBits: options.hashcashBits ?? envNum('HASHCASH_BITS', 20),
    roomTtlMs: options.roomTtlMs ?? envNum('ROOM_TTL_MIN', 120) * 60e3,
    idleTtlMs: options.idleTtlMs ?? envNum('IDLE_TTL_MIN', 10) * 60e3,
    rateBps: options.rateBps ?? envNum('RATE_KBPS', 5) * 1024,
  });

  const httpServer = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    try {
      if (url.pathname === '/healthz') {
        return res.writeHead(200, { 'content-type': 'text/plain' }).end('ok');
      }
      if (url.pathname === '/challenge') {
        const body = JSON.stringify(relay.issueChallenge());
        return res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' }).end(body);
      }
      if (url.pathname === '/qr') {
        const text = url.searchParams.get('text') ?? '';
        if (!text || text.length > 512) return res.writeHead(400).end('text required (max 512 chars)');
        const svg = await QRCode.toString(text, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' });
        return res.writeHead(200, { 'content-type': 'image/svg+xml', 'cache-control': 'no-store' }).end(svg);
      }
      if (req.method !== 'GET' && req.method !== 'HEAD') return res.writeHead(405).end('method not allowed');

      let path = normalize(decodeURIComponent(url.pathname));
      if (path.endsWith('/')) path += 'index.html';
      const file = join(publicDir, path);
      if (!file.startsWith(publicDir)) return res.writeHead(403).end('forbidden');
      const body = await readFile(file);
      res
        .writeHead(200, { 'content-type': types[extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-cache' })
        .end(req.method === 'HEAD' ? undefined : body);
    } catch (err) {
      const missing = err.code === 'ENOENT' || err.code === 'EISDIR';
      res.writeHead(missing ? 404 : 500).end(missing ? 'not found' : 'error');
    }
  });

  const wss = new WebSocketServer({ noServer: true, maxPayload: 16 * 1024 });
  httpServer.on('upgrade', (req, socket, head) => {
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws));
  });

  const joined = (room, member) => ({
    t: 'joined',
    room: room.id,
    token: member.token,
    you: member.id,
    name: member.name,
    host: member.token === room.host,
    started: room.started,
    peers: relay.peers(room),
  });

  const broadcastPeers = (room) => {
    const peers = relay.peers(room);
    for (const m of room.members.values()) send(m.ws, { t: 'peers', started: room.started, peers });
  };

  wss.on('connection', (ws) => {
    let me = null; // { room, member }

    ws.on('error', () => {});
    ws.on('close', () => {
      // keep the member around so a reload can rejoin with its token until the idle timeout
      if (me && me.member.ws === ws) {
        me.member.ws = null;
        broadcastPeers(me.room);
      }
    });

    ws.on('message', (raw, isBinary) => {
      if (isBinary) return ws.close(1003, 'text only');
      let msg;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return send(ws, { t: 'error', code: 'bad-json' });
      }

      try {
        if (msg.t === 'create') {
          const { room, member } = relay.create(msg.proof, msg.name);
          me = { room, member };
          member.ws = ws;
          send(ws, joined(room, member));
          broadcastPeers(room);
        } else if (msg.t === 'join') {
          const { room, member } = relay.join(msg.room, msg.token, msg.name);
          if (member.ws && member.ws !== ws) member.ws.close(4000, 'replaced');
          if (me && me.member !== member) me.member.ws = null;
          me = { room, member };
          member.ws = ws;
          send(ws, joined(room, member));
          broadcastPeers(room);
        } else if (msg.t === 'start') {
          if (!me) throw Object.assign(new Error('join or create first'), { code: 'not-joined' });
          const room = relay.start(me.room.id, me.member.token);
          for (const m of room.members.values()) send(m.ws, { t: 'started' });
          broadcastPeers(room);
        } else if (msg.t === 'msg') {
          if (!me) throw Object.assign(new Error('join or create first'), { code: 'not-joined' });
          const { member, recipients, limited } = relay.say(me.room.id, me.member.token, msg.data, raw.length);
          if (limited) {
            if (Date.now() - (member.warnedAt ?? 0) > 1000) {
              member.warnedAt = Date.now();
              send(ws, { t: 'error', code: 'rate-limit' });
            }
            return;
          }
          for (const m of recipients) send(m.ws, { t: 'msg', from: member.id, name: member.name, data: msg.data });
        } else {
          send(ws, { t: 'error', code: 'unknown', message: String(msg.t) });
        }
      } catch (err) {
        send(ws, { t: 'error', code: err.code ?? 'error', message: err.message });
      }
    });
  });

  const timer = setInterval(() => {
    for (const { room, reason } of relay.sweep()) {
      for (const m of room.members.values()) {
        send(m.ws, { t: 'closed', reason });
        m.ws?.close(4001, reason);
      }
    }
  }, options.sweepMs ?? envNum('SWEEP_MS', 30e3));
  timer.unref();

  await new Promise((resolve, reject) => {
    httpServer.once('error', reject);
    httpServer.listen(options.port ?? envNum('PORT', 80), options.host ?? '0.0.0.0', resolve);
  });

  return {
    relay,
    url: `http://127.0.0.1:${httpServer.address().port}`,
    async close() {
      clearInterval(timer);
      for (const client of wss.clients) client.terminate();
      await new Promise((resolve) => wss.close(resolve));
      await new Promise((resolve) => httpServer.close(resolve));
    },
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  startServer().then(({ url }) => console.log(`lobby listening on ${url} (port ${new URL(url).port})`));
}
