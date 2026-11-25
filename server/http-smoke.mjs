import assert from 'node:assert/strict';
import { once } from 'node:events';
import { spawn } from 'node:child_process';

const child = spawn(process.execPath, ['server/index.js'], {
  env: { ...process.env, PORT: '0', HOST: '127.0.0.1', ALIGN_DATABASE: ':memory:', BRAVE_SEARCH_API_KEY: '', ALIGN_USER: '', ALIGN_PASSWORD: '' },
  stdio: ['ignore', 'pipe', 'inherit'],
});
try {
  const [output] = await once(child.stdout, 'data');
  const base = output.toString().match(/http:\/\/127\.0\.0\.1:\d+/)?.[0];
  assert.ok(base, 'The server should announce its bound port.');
  async function json(path, method = 'GET', body) {
    const response = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    assert.ok(response.ok, await response.clone().text());
    return response.json();
  }
  const org = await json('/api/organizations', 'POST', { name: 'Smoke Test', type: 'Church', focus: 'Both', scope: 'Local', state: 'NC', status: 'partnering' });
  const task = await json('/api/organizations/' + org.id + '/tasks', 'POST', { title: 'Call back', priority: 'medium', status: 'open' });
  await json('/api/organizations/' + org.id + '/tasks/' + task.id, 'PUT', { status: 'completed' });
  const snapshot = await json('/api');
  assert.equal(snapshot.organizations[0].history[0].partnering, true);
  assert.equal(snapshot.entries[0].status, 'completed');
  for (const path of ['/', '/app.js', '/map.js', '/style.css', '/us-states.json']) assert.ok((await fetch(base + path)).ok);
  console.log('HTTP workflow and asset smoke checks passed.');
} finally {
  child.kill();
}
