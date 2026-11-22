// Night City final pass: crowd streaming, dashboard radar and wet asphalt.
// A tiny static server for game/ (Node 22, standard library only), so an entry can be played
// locally without a build step: `node serve.ts` serves game/ on http://localhost:8080.
// It sends the MIME types a browser game needs, refuses any path outside game/, answers every
// response no-store so a reload always shows the current file, and closes its listener on
// SIGINT or SIGTERM. Otherwise it does nothing clever: this is a development convenience,
// not a web server for the internet.
import { createReadStream, statSync } from 'node:fs';
import { createServer, type ServerResponse } from 'node:http';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('./game', import.meta.url)));
const args = process.argv.slice(2);
const portIndex = args.indexOf('--port');
const requested = portIndex === -1 ? 8080 : Number(args[portIndex + 1]);
const port = Number.isInteger(requested) && requested > 0 && requested < 65536 ? requested : 8080;

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.glb': 'model/gltf-binary',
  '.gltf': 'model/gltf+json',
  '.bin': 'application/octet-stream',
  '.wasm': 'application/wasm',
  '.wav': 'audio/wav',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.txt': 'text/plain; charset=utf-8',
};

/** A plain-text response: every reply, errors included, is uncached. */
function sendText(response: ServerResponse, status: number, body: string): void {
  const payload = Buffer.from(`${body}\n`, 'utf8');
  response.writeHead(status, {
    'content-type': 'text/plain; charset=utf-8',
    'content-length': payload.length,
    'cache-control': 'no-store',
  });
  response.end(payload);
}

const server = createServer((request, response) => {
  const url = new URL(request.url ?? '/', 'http://localhost');
  let pathname: string;
  try {
    pathname = decodeURIComponent(url.pathname);
  } catch {
    sendText(response, 400, 'bad request');
    return;
  }
  // A decoded NUL would make statSync throw on some platforms; refuse it up front.
  if (pathname.includes('\0')) {
    sendText(response, 400, 'bad request');
    return;
  }
  if (pathname.endsWith('/')) pathname += 'index.html';
  let file = resolve(join(root, normalize(pathname)));
  if (file !== root && !file.startsWith(root + sep)) {
    sendText(response, 403, 'forbidden');
    return;
  }

  let size: number;
  try {
    let stats = statSync(file);
    if (stats.isDirectory()) {
      // /sub -> /sub/ : serve the directory's index.html rather than a 404.
      file = join(file, 'index.html');
      stats = statSync(file);
    }
    if (!stats.isFile()) throw new Error('not a file');
    size = stats.size;
  } catch {
    sendText(response, 404, 'not found');
    return;
  }

  const stream = createReadStream(file);
  stream.on('error', () => {
    // A read that fails after the head is out can only kill the connection.
    if (response.headersSent) response.destroy();
    else sendText(response, 500, 'read error');
  });
  response.writeHead(200, {
    'content-type': MIME[extname(file).toLowerCase()] ?? 'application/octet-stream',
    'content-length': size,
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  });
  stream.pipe(response);
});

server.on('error', (err: Error) => {
  console.error(`serve      FAILED: ${err.message}`);
  process.exitCode = 1;
});

server.listen(port, '127.0.0.1', () => {
  console.log(`game/ is on http://localhost:${port}`);
});

// Ctrl-C (or a supervisor's SIGTERM) stops accepting connections, lets the open
// responses finish, and exits 0; a hung socket gets 2 seconds before it is cut.
let closing = false;
function shutdown(signal: string): void {
  if (closing) return;
  closing = true;
  console.log(`serve      ${signal}: closing http://localhost:${port}`);
  server.close(() => {
    console.log('serve      closed');
    process.exit(0);
  });
  // Keep-alive connections from an idle browser would hold close() open forever.
  server.closeIdleConnections();
  setTimeout(() => {
    server.closeAllConnections();
    process.exit(0);
  }, 2000).unref();
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
