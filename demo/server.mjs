// Tiny zero-dependency demo server: static files + a fake API with realistic quirks.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(fileURLToPath(import.meta.url), '..', '..');
// Not 5173: Vite's default port often has stale service workers / caches from other projects.
const PORT = Number(process.env.PORT) || 4747;
const types = { '.html': 'text/html', '.js': 'text/javascript', '.map': 'application/json', '.css': 'text/css' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const leads = Array.from({ length: 8 }, (_, i) => ({
  id: i + 1, name: `Lead ${i + 1}`, email: `lead${i + 1}@example.com`, status: ['new', 'won', 'lost'][i % 3],
  score: Math.round(Math.random() * 100), owner: { id: 7, name: 'Sam', email: 'sam@example.com', phone: '555-0100' },
  address: { street: '1 Main St', city: 'Springfield', zip: '12345' }, tags: ['b2b'], createdAt: new Date().toISOString(),
}));

function json(res, status, body, extra = {}) {
  res.writeHead(status, { 'content-type': 'application/json', ...extra });
  res.end(JSON.stringify(body));
}

async function api(req, res, url) {
  const p = url.pathname;
  await sleep(40 + Math.random() * 120);
  if (p === '/api/lead' && req.method === 'GET') return json(res, 200, leads);
  if (p === '/api/lead' && req.method === 'POST') return json(res, 201, { id: 99, ok: true });
  let m = /^\/api\/lead\/(\d+)$/.exec(p);
  if (m) {
    const lead = leads.find((l) => l.id === Number(m[1]));
    return lead ? json(res, 200, lead) : json(res, 404, { error: 'not found' });
  }
  if ((m = /^\/api\/lead\/(\d+)\/notes$/.exec(p))) return json(res, 200, [{ id: 1, text: 'Called', at: new Date().toISOString() }]);
  if (p === '/api/user/me') return json(res, 200, { id: 7, name: 'Sam', role: 'admin', token: 'abc123' });
  if (p === '/api/config') return json(res, 200, { featureFlags: { newUi: true }, version: '1.2.3' });
  if (p === '/api/slow') {
    await sleep(1600);
    return json(res, 200, { ok: true });
  }
  if (p === '/api/fail') return json(res, 500, { error: 'Something broke' });
  if (p === '/api/track') {
    res.writeHead(204);
    return res.end();
  }
  if (p === '/graphql') {
    let body = '';
    for await (const c of req) body += c;
    const { operationName } = JSON.parse(body || '{}');
    return json(res, 200, { data: { op: operationName, leads: leads.slice(0, 2).map(({ id, name }) => ({ id, name })) } });
  }
  if (p === '/api/events') {
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
    for (let i = 1; i <= 3; i++) {
      res.write(`event: ${i === 2 ? 'leadUpdated' : 'message'}\ndata: {"tick":${i}}\n\n`);
      await sleep(700);
    }
    return res.end();
  }
  return json(res, 404, { error: 'unknown endpoint' });
}

createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  if (url.pathname.startsWith('/api/') || url.pathname === '/graphql') return api(req, res, url);
  const rel = url.pathname === '/' ? '/demo/index.html' : url.pathname;
  const file = normalize(join(root, rel));
  if (!file.startsWith(root)) return json(res, 403, {});
  try {
    const data = await readFile(file);
    res.writeHead(200, { 'content-type': types[extname(file)] ?? 'application/octet-stream' });
    res.end(data);
  } catch {
    // Missing assets must 404 (never return HTML for a .js request).
    if (extname(url.pathname)) return json(res, 404, { error: 'not found' });
    // SPA fallback so pushState routes reload fine
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end(await readFile(join(root, 'demo/index.html')));
  }
}).listen(PORT, () => console.log(`api-pingpong demo → http://localhost:${PORT}`));
