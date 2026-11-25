import { createServer } from 'node:http';
import { createHash, timingSafeEqual } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { openStore } from './store.js';
import { scheduleDiscovery } from './discovery.js';

const host = process.env.HOST || '127.0.0.1';
const credentials = process.env.ALIGN_USER && process.env.ALIGN_PASSWORD
  ? Buffer.from(`${process.env.ALIGN_USER}:${process.env.ALIGN_PASSWORD}`).toString('base64') : '';
if (!credentials && !['127.0.0.1', '::1', 'localhost'].includes(host)) {
  throw new Error('Set ALIGN_USER and ALIGN_PASSWORD before binding to a shared interface.');
}
const discoveryEnabled = Boolean(process.env.BRAVE_SEARCH_API_KEY);
const hour = Number(process.env.DISCOVERY_HOUR ?? 6);
if (!Number.isInteger(hour) || hour < 0 || hour > 23) throw new Error('DISCOVERY_HOUR must be 0–23.');
const filename = process.env.ALIGN_DATABASE === ':memory:' ? ':memory:' : resolve(process.env.ALIGN_DATABASE || 'data/align.sqlite');
if (filename !== ':memory:') mkdirSync(dirname(filename), { recursive: true });
const store = openStore(filename);
const digest = value => createHash('sha256').update(value).digest();
const assets = new Map([
  ['/', ['public/index.html', 'text/html; charset=utf-8']],
  ['/style.css', ['public/style.css', 'text/css; charset=utf-8']],
  ['/app.js', ['src/app.js', 'text/javascript; charset=utf-8']],
  ['/model.js', ['src/model.js', 'text/javascript; charset=utf-8']],
  ['/engage-labels.js', ['src/engage-labels.js', 'text/javascript; charset=utf-8']],
  ['/engage-suggestions.js', ['src/engage-suggestions.js', 'text/javascript; charset=utf-8']],
  ['/map.js', ['src/map.js', 'text/javascript; charset=utf-8']],
  ['/csv.js', ['src/csv.js', 'text/javascript; charset=utf-8']],
  ['/us-states.json', ['public/us-states.json', 'application/json']],
]);

async function body(request) {
  let size = 0;
  const chunks = [];
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 2_000_000) throw new Error('The request is too large.');
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString());
}

const server = createServer(async (request, response) => {
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('Content-Security-Policy', "default-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
  if (credentials && !timingSafeEqual(digest(request.headers.authorization || ''), digest(`Basic ${credentials}`))) {
    response.writeHead(401, { 'WWW-Authenticate': 'Basic realm="Align-this", charset="UTF-8"' }).end('Authentication required');
    return;
  }
  const json = (code, data) => response.writeHead(code, { 'Content-Type': 'application/json' }).end(JSON.stringify(data));
  const path = new URL(request.url, 'http://localhost').pathname;
  const method = request.method;
  try {
    if (method === 'GET' && assets.has(path)) {
      const [file, type] = assets.get(path);
      const data = await readFile(new URL(`../${file}`, import.meta.url));
      response.writeHead(200, { 'Content-Type': type }).end(data);
      return;
    }
    if (path === '/api' && method === 'GET') return json(200, { ...store.snapshot(), discoveryEnabled, discoveryHour: hour });
    if (!['POST', 'PUT', 'DELETE'].includes(method) || !path.startsWith('/api/')) return json(404, { error: 'Not found.' });
    if (request.headers['sec-fetch-site'] === 'cross-site' || !/^application\/json(?:;|$)/i.test(request.headers['content-type'] || '')) {
      return json(415, { error: 'Use a same-origin JSON request.' });
    }
    const input = method === 'DELETE' ? null : await body(request);
    if (path === '/api/organizations' && method === 'POST') return json(201, store.organization(input));
    if (path === '/api/import' && method === 'POST' && Array.isArray(input) && input.length <= 1000) return json(201, store.importOrganizations(input));
    const [, , resource, id, section, entryId, ...extra] = path.split('/');
    if (extra.length) return json(404, { error: 'Not found.' });
    if (resource === 'organizations' && id) {
      if (!section && method === 'PUT') return json(200, store.organization(input, id));
      if (section && !entryId && method === 'POST') return json(201, store.entry(id, section, input));
      if (entryId && method === 'PUT') return json(200, store.entry(id, section, input, entryId));
      if (entryId && method === 'DELETE') return json(200, { deleted: store.deleteEntry(id, section, entryId).changes });
    }
    if (resource === 'candidates' && id && !section && method === 'POST' && ['approve', 'dismiss'].includes(input.action)) {
      store.resolveCandidate(id, input.action, input);
      return json(200, { ok: true });
    }
    return json(404, { error: 'Not found.' });
  } catch (error) {
    return json(400, { error: error.message });
  }
});
server.listen(Number(process.env.PORT || 3000), host, () => {
  console.log(`Align-this listening on http://${host}:${server.address().port}`);
});

scheduleDiscovery(store, process.env.BRAVE_SEARCH_API_KEY, hour);
