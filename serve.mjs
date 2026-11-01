// Tiny preview gateway: the first path segment is navigation only.
// /games/ -> static games, /lobby/ -> lobby server, / -> /games/.
import { createServer, request } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { pathToFileURL } from 'node:url';

const DEFAULT_ROOT = join(process.cwd(), 'games');
const types = {
  '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon', '.txt': 'text/plain',
};

// undefined = not a lobby path, null = redirect to /lobby/
const lobbyPath = (path) => {
  if (path === '/lobby') return null;
  if (path.startsWith('/lobby/')) return path.slice('/lobby'.length);
  return undefined;
};

const writeUpgradeResponse = (socket, res, body) => {
  socket.write(`HTTP/1.1 ${res.statusCode} ${res.statusMessage}\r\n`);
  for (let i = 0; i < res.rawHeaders.length; i += 2) {
    socket.write(`${res.rawHeaders[i]}: ${res.rawHeaders[i + 1]}\r\n`);
  }
  socket.write('\r\n');
  if (body?.length) socket.write(body);
};

export async function startServer({
  port = 8000,
  root = DEFAULT_ROOT,
  lobby = process.env.LOBBY_URL ?? 'http://127.0.0.1:8080',
} = {}) {
  const lobbyUrl = new URL(lobby);

  const proxy = (req, res, path) => {
    const upstream = request({
      hostname: lobbyUrl.hostname,
      port: lobbyUrl.port,
      method: req.method,
      path,
      headers: req.headers,
    }, (up) => {
      res.writeHead(up.statusCode, up.headers);
      up.pipe(res);
    });
    upstream.on('error', () => {
      if (!res.headersSent) res.writeHead(502, { 'content-type': 'text/plain' });
      res.end('lobby unavailable');
    });
    req.pipe(upstream);
  };

  const server = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const proxied = lobbyPath(url.pathname);
    if (proxied === null) return res.writeHead(302, { location: `/lobby/${url.search}` }).end();
    if (proxied !== undefined) return proxy(req, res, proxied + url.search);

    let path = normalize(decodeURIComponent(url.pathname));
    if (path === '/' || path === '/games') {
      return res.writeHead(302, { location: `/games/${url.search}` }).end();
    }
    if (!path.startsWith('/games/')) return res.writeHead(404).end('not found');
    path = path.slice('/games'.length);
    if (path.endsWith('/')) path += 'index.html';
    const file = join(root, path);
    if (!file.startsWith(root)) return res.writeHead(403).end('forbidden');
    try {
      const body = await readFile(file);
      res.writeHead(200, {
        'content-type': types[extname(file)] ?? 'application/octet-stream',
        'cache-control': 'no-store',
      }).end(body);
    } catch {
      res.writeHead(404).end('not found');
    }
  });

  server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url, 'http://localhost');
    const path = lobbyPath(url.pathname);
    if (path !== '/ws') return socket.destroy();

    const upstream = request({
      hostname: lobbyUrl.hostname,
      port: lobbyUrl.port,
      method: req.method,
      path: path + url.search,
      headers: req.headers,
    });
    upstream.on('upgrade', (res, upstreamSocket, upstreamHead) => {
      writeUpgradeResponse(socket, res, upstreamHead);
      if (head.length) upstreamSocket.write(head);
      upstreamSocket.on('error', () => socket.destroy());
      socket.on('error', () => upstreamSocket.destroy());
      upstreamSocket.pipe(socket).pipe(upstreamSocket);
    });
    upstream.on('response', (res) => {
      writeUpgradeResponse(socket, res);
      res.pipe(socket);
    });
    upstream.on('error', () => socket.destroy());
    upstream.end();
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, resolve);
  });

  return {
    server,
    url: `http://127.0.0.1:${server.address().port}`,
    root,
    lobby: lobbyUrl.href,
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  startServer({ port: Number(process.argv[2]) || 8000 }).then(({ url, root, lobby }) =>
    console.log(`serving ${root} at ${url}/games/ and ${lobby} at ${url}/lobby/`));
}
