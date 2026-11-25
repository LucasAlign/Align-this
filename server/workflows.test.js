import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { openStore } from './store.js';
import { countsAt, loadMap } from '../src/map.js';
import { today } from '../src/model.js';
import { parseCsv } from '../src/csv.js';
import { suggestFromInteractionNotes } from '../src/engage-suggestions.js';

const organization = { name: 'Example Family Support', type: 'Nonprofit', focus: 'Both', scope: 'Regional', state: 'PA' };

test('tracks partner entry, relocation, and exit without double-counting', () => {
  const store = openStore(':memory:');
  const partner = store.organization({ ...organization, status: 'partnering' });
  assert.deepEqual(countsAt(store.snapshot().organizations, today()), { PA: 1 });
  store.organization({ ...partner, state: 'OH' }, partner.id);
  assert.deepEqual(countsAt(store.snapshot().organizations, today()), { OH: 1 });
  store.organization({ ...partner, state: 'OH', status: 'potential' }, partner.id);
  assert.deepEqual(countsAt(store.snapshot().organizations, today()), {});
  store.db.close();
});

test('rejects duplicate imports atomically and preserves profile workflows', () => {
  const store = openStore(':memory:');
  assert.throws(() => store.importOrganizations([organization, organization]), /already exists/);
  assert.equal(store.snapshot().organizations.length, 0);
  const org = store.organization(organization);
  const notes = 'We will follow up tomorrow.';
  const suggestion = suggestFromInteractionNotes(notes, '2026-11-24').followUp;
  assert.equal(suggestion.dueDate, '2026-11-25');
  store.entry(org.id, 'interactions', { type: 'meeting', date: today(), subject: 'Intro', notes });
  const task = store.entry(org.id, 'tasks', { ...suggestion, owner: 'Coordinator', priority: 'high', status: 'open' });
  const completed = store.entry(org.id, 'tasks', { status: 'completed' }, task.id);
  assert.equal(completed.status, 'completed');
  assert.equal(completed.owner, 'Coordinator');
  store.db.close();
});

test('deduplicates discovery runs and approved candidates while preserving provenance', () => {
  const store = openStore(':memory:');
  const day = today();
  assert.equal(store.claimRun(day), true);
  assert.equal(store.claimRun(day), false);
  const first = { ...organization, source: 'https://example.org/program', website: 'https://example.org/' };
  assert.equal(store.saveCandidates([first, { ...first, source: 'https://www.example.org/contact' }]), 1);
  const candidate = store.snapshot().candidates[0];
  store.resolveCandidate(candidate.id, 'approve', candidate);
  assert.equal(store.snapshot().organizations[0].source, first.source);
  assert.equal(store.snapshot().organizations[0].status, 'unreached');
  assert.equal(store.snapshot().candidates.length, 0);
  assert.equal(store.saveCandidates([first]), 0);
  store.db.close();
});

test('loads geographic geometry for all 50 states and D.C.', async t => {
  const topology = await readFile(new URL('../public/us-states.json', import.meta.url), 'utf8');
  t.mock.method(globalThis, 'fetch', async () => new Response(topology));
  const map = await loadMap();
  assert.equal(new Set(map.map(item => item.code)).size, 51);
  assert.ok(map.every(item => item.path.startsWith('M') && !item.path.includes('NaN')));
});

test('imports quoted commas and newlines from spreadsheet CSV', () => {
  const [org] = parseCsv('name,type,focus,scope,state,summary\r\n"Example, Inc.",Nonprofit,Both,Local,PA,"first\nsecond"\r\n');
  assert.equal(org.name, 'Example, Inc.');
  assert.equal(org.summary, 'first\nsecond');
});

test('daily discovery rotates states and keeps source evidence', async () => {
  const { discover } = await import('./discovery.js');
  const requests = [];
  const fetcher = async (url, options) => {
    assert.equal(options.headers['X-Subscription-Token'], 'test-key');
    requests.push(url.searchParams.get('q'));
    return Response.json({ web: { results: [
      { title: 'Example Foster Care Ministry', url: 'https://fosterministry.example/foster', description: 'Foster families and adoption support' },
      { title: 'No relevance', url: 'https://irrelevant.example/', description: 'General food pantry' },
      { title: 'Foster care page', url: 'https://www.facebook.com/example', description: 'Foster care' },
    ] } });
  };
  const first = await discover({ day: '2026-11-24', apiKey: 'test-key', fetcher, pause: async () => {} });
  const second = await discover({ day: '2026-11-25', apiKey: 'test-key', fetcher, pause: async () => {} });
  assert.equal(requests.length, 20);
  assert.equal(new Set(requests.map(query => query.split('"')[1])).size, 10);
  assert.equal(first.length, 1);
  assert.equal(first[0].type, 'Church');
  assert.equal(first[0].focus, 'Both');
  assert.equal(first[0].source, 'https://fosterministry.example/foster');
  assert.notEqual(first[0].state, second[0].state);
});
