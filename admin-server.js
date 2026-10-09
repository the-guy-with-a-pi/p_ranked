const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { loadAdminKey } = require('./admin-key');

const ADMIN_PORT = Number(process.env.ADMIN_PORT || 3002);
const GAME_ORIGIN = process.env.GAME_ORIGIN || `http://127.0.0.1:${process.env.PORT || 3000}`;
const DATA_DIR = path.resolve(process.env.DATA_DIR || __dirname);
const ADMIN_KEY = loadAdminKey(DATA_DIR);
const PUBLIC_DIR = path.join(__dirname, 'public');

function isPrivateAddress(value) {
  const address = String(value || '').toLowerCase().replace(/^::ffff:/, '');
  if (address === '::1' || address.startsWith('fc') || address.startsWith('fd') || /^fe[89ab]/.test(address)) return true;
  const parts = address.split('.').map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false;
  return parts[0] === 10
    || parts[0] === 127
    || (parts[0] === 192 && parts[1] === 168)
    || (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31)
    || (parts[0] === 169 && parts[1] === 254);
}

function sendJson(response, status, body) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  response.end(JSON.stringify(body));
}

async function readBody(request) {
  let body = '';
  for await (const chunk of request) {
    body += chunk;
    if (body.length > 2048) throw Object.assign(new Error('Request body is too large.'), { status: 413 });
  }
  return body;
}

async function proxyAdminRequest(request, response, pathname) {
  const userRoute = pathname.match(/^\/api\/users\/([a-f0-9-]+)\/(elo|delete)$/i);
  if (pathname !== '/api/users' && !userRoute) return sendJson(response, 404, { error: 'Not found.' });
  if (pathname === '/api/users' && request.method !== 'GET') return sendJson(response, 405, { error: 'Method not allowed.' });
  if (userRoute && request.method !== 'POST') return sendJson(response, 405, { error: 'Method not allowed.' });

  let body;
  if (request.method === 'POST') {
    try { body = await readBody(request); } catch (error) {
      return sendJson(response, error.status || 400, { error: error.message });
    }
  }
  const internalPath = pathname.replace(/^\/api/, '/internal/admin');
  try {
    const upstream = await fetch(new URL(internalPath, GAME_ORIGIN), {
      method: request.method,
      headers: { 'x-admin-key': ADMIN_KEY, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body,
    });
    response.writeHead(upstream.status, {
      'Content-Type': upstream.headers.get('content-type') || 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    });
    response.end(await upstream.text());
  } catch (error) {
    console.error('Admin API unavailable:', error.message);
    sendJson(response, 502, { error: 'Game server is unavailable.' });
  }
}

const server = http.createServer(async (request, response) => {
  if (!isPrivateAddress(request.socket.remoteAddress)) return sendJson(response, 403, { error: 'Admin panel is available only on a private network.' });
  let url;
  try { url = new URL(request.url, `http://${request.headers.host || 'localhost'}`); } catch {
    return response.writeHead(400).end('Bad request');
  }
  if (request.headers.origin) {
    try {
      if (new URL(request.headers.origin).host !== request.headers.host) return sendJson(response, 403, { error: 'Request origin is not allowed.' });
    } catch { return sendJson(response, 403, { error: 'Request origin is not allowed.' }); }
  }
  if (url.pathname.startsWith('/api/')) return proxyAdminRequest(request, response, url.pathname);
  if (request.method !== 'GET') return response.writeHead(405, { Allow: 'GET' }).end('Method not allowed');

  let filePath;
  try {
    const relative = decodeURIComponent(url.pathname === '/' ? '/admin.html' : url.pathname);
    filePath = path.resolve(PUBLIC_DIR, `.${relative}`);
  } catch { return response.writeHead(400).end('Bad request'); }
  if (!filePath.startsWith(`${PUBLIC_DIR}${path.sep}`) || !fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    return response.writeHead(404).end('Not found');
  }
  const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8' };
  response.writeHead(200, { 'Content-Type': types[path.extname(filePath)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
  fs.createReadStream(filePath).pipe(response);
});

server.listen(ADMIN_PORT, '0.0.0.0', () => {
  console.log(`LAN admin panel listening on http://0.0.0.0:${ADMIN_PORT}`);
});
