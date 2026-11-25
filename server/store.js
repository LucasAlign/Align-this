import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { states, types, focuses, scopes, today } from '../src/model.js';
import { ENGAGEMENT_STATUS_ORDER, INTERACTION_TYPE, TASK_PRIORITY, TASK_STATUS } from '../src/engage-labels.js';

const fields = {
  contacts: ['name', 'role', 'email', 'phone'],
  interactions: ['type', 'date', 'subject', 'notes'],
  tasks: ['title', 'owner', 'dueDate', 'priority', 'status'],
  notes: ['text'],
  signups: ['name', 'email', 'interest', 'status'],
};

export function clean(value, limit = 4000) {
  return typeof value === 'string' ? value.trim().slice(0, limit) : '';
}

export function website(value) {
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password ? url.href : '';
  } catch {
    return '';
  }
}

const normalize = value => value.toLowerCase().replace(/[^a-z0-9]/g, '');
const domain = url => url ? new URL(url).hostname.replace(/^www\./, '') : '';
function validDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value)) &&
    new Date(value).toISOString().slice(0, 10) === value;
}

export function openStore(filename) {
  const db = new DatabaseSync(filename);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA busy_timeout = 5000;
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS organizations (id TEXT PRIMARY KEY, data TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS entries (
      id TEXT PRIMARY KEY, org TEXT NOT NULL REFERENCES organizations(id), section TEXT NOT NULL, data TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS entries_org ON entries(org, section);
    CREATE TABLE IF NOT EXISTS candidates (id TEXT PRIMARY KEY, data TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS discovery_runs (day TEXT PRIMARY KEY, data TEXT NOT NULL);
  `);
  const read = (table, id) => JSON.parse(db.prepare(`SELECT data FROM ${table} WHERE id = ?`).get(id)?.data || 'null');
  const list = table => db.prepare(`SELECT data FROM ${table}`).all().map(row => JSON.parse(row.data));
  const put = (table, item) => db.prepare(`INSERT INTO ${table} VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET data=excluded.data`).run(item.id, JSON.stringify(item));
  const transaction = work => {
    db.exec('BEGIN IMMEDIATE');
    try {
      const result = work();
      db.exec('COMMIT');
      return result;
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  };

  function organization(input, id) {
    const previous = id ? read('organizations', id) : null;
    if (id && !previous) throw new Error('Organization not found.');
    const name = clean(input.name, 200);
    const state = clean(input.state, 2).toUpperCase();
    const status = input.status || 'unreached';
    if (!name || !Object.hasOwn(states, state) || !types.includes(input.type) ||
      !focuses.includes(input.focus) || !scopes.includes(input.scope) ||
      !ENGAGEMENT_STATUS_ORDER.includes(status)) throw new Error('Enter a name, U.S. state, type, focus, scope, and valid status.');
    const site = website(input.website);
    if (input.website && !site) throw new Error('Enter a valid HTTP or HTTPS website.');
    const duplicate = list('organizations').some(item => item.id !== id &&
      normalize(item.name) === normalize(name) && item.state === state &&
      (!item.city || !input.city || normalize(item.city) === normalize(input.city)));
    if (duplicate) throw new Error('An organization with this name and location already exists.');
    const history = previous?.history || [];
    if (previous?.status !== status || previous?.state !== state) {
      history.push({ date: today(), state, partnering: status === 'partnering' });
    }
    const item = {
      id: id || randomUUID(), name, state, status, history,
      type: input.type, focus: input.focus, scope: input.scope, website: site,
      city: clean(input.city, 120), address: clean(input.address, 300),
      email: clean(input.email, 250), phone: clean(input.phone, 60),
      summary: clean(input.summary), source: previous?.source || website(input.source),
      discoveredOn: previous?.discoveredOn || (validDate(clean(input.discoveredOn)) ? input.discoveredOn : ''),
    };
    put('organizations', item);
    return item;
  }

  function entry(org, section, input, id) {
    if (!read('organizations', org) || !Object.hasOwn(fields, section)) throw new Error('Invalid profile section.');
    const previous = id && db.prepare('SELECT data FROM entries WHERE id=? AND org=? AND section=?').get(id, org, section);
    if (id && !previous) throw new Error('Entry not found.');
    const values = Object.fromEntries(fields[section].map(key => [key, clean(input[key] ?? (previous ? JSON.parse(previous.data)[key] : ''))]));
    if (!values[fields[section][0]]) throw new Error('Fill in the required field.');
    if (section === 'interactions' && (!Object.hasOwn(INTERACTION_TYPE, values.type) || !validDate(values.date) || !values.subject)) throw new Error('Enter a valid interaction type, date, and subject.');
    if (section === 'tasks' && (!Object.hasOwn(TASK_PRIORITY, values.priority) || !Object.hasOwn(TASK_STATUS, values.status) || (values.dueDate && !validDate(values.dueDate)))) throw new Error('Enter a valid task priority, status, and due date.');
    if (section === 'signups' && !['New', 'Needs follow-up', 'Connected'].includes(values.status)) throw new Error('Choose a signup status.');
    const item = { ...values, id: id || randomUUID(), org, section, createdOn: previous ? JSON.parse(previous.data).createdOn : today() };
    db.prepare('INSERT INTO entries VALUES (?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET data=excluded.data')
      .run(item.id, org, section, JSON.stringify(item));
    return item;
  }

  return {
    db,
    snapshot: () => ({
      organizations: list('organizations'),
      entries: list('entries'),
      candidates: list('candidates').filter(item => item.status === 'pending'),
      runs: db.prepare('SELECT data FROM discovery_runs ORDER BY day DESC LIMIT 14').all().map(row => JSON.parse(row.data)),
    }),
    organization: (input, id) => transaction(() => organization(input, id)),
    entry,
    deleteEntry: (org, section, id) => db.prepare('DELETE FROM entries WHERE org=? AND section=? AND id=?').run(org, section, id),
    importOrganizations: rows => transaction(() => rows.map(row => organization(row))),
    resolveCandidate: (id, action, input) => transaction(() => {
      const candidate = read('candidates', id);
      if (!candidate || candidate.status !== 'pending') throw new Error('Candidate already reviewed.');
      if (action === 'approve') organization({ ...input, status: 'unreached', source: candidate.source, discoveredOn: candidate.discoveredOn });
      candidate.status = action === 'approve' ? 'approved' : 'dismissed';
      put('candidates', candidate);
    }),
    saveCandidates: candidates => transaction(() => {
      const known = new Set([...list('organizations').map(item => domain(item.website)), ...list('candidates').map(item => domain(item.source))]);
      let added = 0;
      for (const item of candidates) {
        const key = domain(item.source);
        if (!key || known.has(key)) continue;
        known.add(key);
        put('candidates', { ...item, id: randomUUID(), status: 'pending', discoveredOn: today() });
        added++;
      }
      return added;
    }),
    claimRun: day => {
      const startedAt = new Date().toISOString();
      const staleBefore = new Date(Date.now() - 20 * 60_000).toISOString();
      return db.prepare(`
        INSERT INTO discovery_runs VALUES (?, ?)
        ON CONFLICT(day) DO UPDATE SET data=excluded.data
        WHERE json_extract(discovery_runs.data, '$.status') = 'running'
          AND coalesce(json_extract(discovery_runs.data, '$.startedAt'), '') < ?
      `).run(day, JSON.stringify({ day, status: 'running', startedAt }), staleBefore).changes > 0;
    },
    finishRun: run => db.prepare('UPDATE discovery_runs SET data=? WHERE day=?').run(JSON.stringify(run), run.day),
  };
}
