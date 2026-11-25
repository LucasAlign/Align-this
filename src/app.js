import { states, types, focuses, scopes, today } from './model.js';
import { ENGAGEMENT_STATUS as statuses, ENGAGEMENT_STATUS_ORDER as statusOrder, INTERACTION_TYPE as interactions, TASK_PRIORITY as priorities, TASK_STATUS as taskStatuses } from './engage-labels.js';
import { suggestFromInteractionNotes } from './engage-suggestions.js';
import { countsAt, loadMap } from './map.js';
import { csvFields, downloadCsv, parseCsv } from './csv.js';

const app = document.querySelector('#app');
const dialog = document.querySelector('#editor');
const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const options = (items, selected) => items.map(item => {
  const [value, label] = Array.isArray(item) ? item : [item, item];
  return `<option value="${escape(value)}"${selected === value ? ' selected' : ''}>${escape(label)}</option>`;
}).join('');
const enumOptions = object => Object.entries(object).map(([key, item]) => [key, item.label]);
const statusOptions = statusOrder.map(key => [key, statuses[key].label]);
const stateOptions = Object.entries(states).map(([code, state]) => [code, state.name]).sort((a, b) => a[1].localeCompare(b[1]));
const filter = { q: '', state: '', type: '', status: '', focus: '', sort: 'name' };
let data = { organizations: [], entries: [], candidates: [], runs: [] };
let map = [];
let mapError = '';
let dateIndex = null;
let playback;
let selectedSection = 'Overview';
let selectedId;
let taskFilter = 'open';
let signupFilter = 'All';

async function request(path = '', method = 'GET', body) {
  const response = await fetch('/api' + path, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.error || 'The workspace could not be reached.');
  }
  return response.json();
}

const badge = item => `<span class="badge ${item?.variant || ''}">${escape(item?.label || '')}</span>`;
const orgLink = org => `<a href="#organization/${escape(org.id)}">${escape(org.name)}</a>`;
const textField = (key, label, value = '', type = 'text', required = false) => `<label>${label}<input name="${key}" type="${type}" value="${escape(value)}"${required ? ' required' : ''}></label>`;
const selectField = (key, label, items, value) => `<label>${label}<select name="${key}">${options(items, value)}</select></label>`;
const area = (key, label, value) => `<label class="wide">${label}<textarea name="${key}" rows="4">${escape(value)}</textarea></label>`;
const empty = message => `<p class="empty">${message}</p>`;
const button = (action, label, extra = '') => `<button type="button" data-action="${action}" ${extra}>${label}</button>`;
const headline = (title, description, actions = '') => `<div class="heading"><div><h1>${title}</h1><p>${description}</p></div><div class="actions">${actions}</div></div>`;
const lastContact = id => data.entries.filter(entry => entry.org === id && entry.section === 'interactions').map(entry => entry.date).sort().at(-1);
const orgById = id => data.organizations.find(org => org.id === id);
const getEntries = section => data.entries.filter(entry => entry.section === section);
const openTasks = () => getEntries('tasks').filter(task => task.status !== 'completed');
const overdue = task => task.status !== 'completed' && task.dueDate && task.dueDate < today();
function mapDates() {
  const events = data.organizations.flatMap(org => org.history.some(row => row.partnering) ? org.history.map(event => event.date) : []);
  if (events.length) {
    const first = new Date(events.sort()[0]);
    first.setUTCDate(first.getUTCDate() - 1);
    events.push(first.toISOString().slice(0, 10));
  }
  return [...new Set([...events, today()])].sort();
}

function mapPanel() {
  const dates = mapDates();
  const index = Math.min(dateIndex ?? dates.length - 1, dates.length - 1);
  const date = dates[index];
  const counts = countsAt(data.organizations, date);
  const total = Object.values(counts).reduce((sum, count) => sum + count, 0);
  const paths = map.map(({ code, path }) => {
    const count = counts[code] || 0;
    const level = count > 9 ? 4 : count > 4 ? 3 : count > 1 ? 2 : count;
    const label = `${states[code].name}: ${count} active partners`;
    return `<a href="#directory" data-action="state" data-state="${code}" aria-label="${label}" aria-pressed="${filter.state === code}"><title>${label}</title><path class="level-${level}" d="${path}"></path></a>`;
  }).join('');
  return `<section class="panel map-panel">
    <div class="panel-head"><div><h2>U.S. partner growth</h2><p>Select a state to explore organizations.</p></div><div class="map-total"><strong>${total}</strong> active partners</div></div>
    ${map.length ? `<svg class="map" viewBox="-62 8 1025 605" role="group" aria-label="United States map by active partners">${paths}</svg>` : empty(mapError || 'Loading state boundaries…')}
    <div class="map-controls">${button('play', playback ? 'Pause' : 'Play history', dates.length < 2 ? 'disabled' : '')}
      <label>As of <strong>${date}</strong><input aria-label="Partner history date" id="history" type="range" min="0" max="${dates.length - 1}" value="${index}" ${dates.length < 2 ? 'disabled' : ''}></label>
      <div class="legend" aria-label="Active partners by state">${['0', '1', '2–4', '5–9', '10+'].map((label, i) => `<span><i class="level-${i}"></i>${label}</span>`).join('')}</div>
    </div>
  </section>`;
}

function filteredOrganizations() {
  const query = filter.q.trim().toLowerCase();
  return data.organizations.filter(org => (!filter.state || org.state === filter.state) &&
    (!filter.type || org.type === filter.type) && (!filter.focus || org.focus === filter.focus) &&
    (!filter.status || org.status === filter.status) &&
    (!query || [org.name, org.city, org.state, org.summary].some(text => text.toLowerCase().includes(query))))
    .sort((a, b) => filter.sort === 'contact' ? (lastContact(b.id) || '').localeCompare(lastContact(a.id) || '') : a.name.localeCompare(b.name));
}

function directoryTable() {
  const rows = filteredOrganizations();
  return rows.length ? `<div class="table-wrap"><table><thead><tr><th>Organization</th><th>Type</th><th>Focus</th><th>Status</th><th>Last contact</th></tr></thead><tbody>
    ${rows.map(org => `<tr><td>${orgLink(org)}<small>${escape([org.city, org.state].filter(Boolean).join(', '))} · ${escape(org.scope)}</small></td><td>${escape(org.type)}</td><td>${escape(org.focus)}</td><td>${badge(statuses[org.status])}</td><td>${lastContact(org.id) || 'Never'}</td></tr>`).join('')}</tbody></table></div>` : empty(data.organizations.length ? 'No organizations match these filters.' : 'Add an organization, import a CSV, or review candidates from Discovery.');
}

function directory() {
  return headline('Outreach directory', 'Track foster care and adoption organizations across the United States.', button('new-org', 'Add organization', 'class="primary"')) +
    `<div class="metrics"><a href="#directory" data-action="partners"><strong>${data.organizations.filter(org => org.status === 'partnering').length}</strong> Partner organizations</a>
    <a href="#tasks" data-action="open-tasks"><strong>${openTasks().length}</strong> Open tasks</a>
    <a href="#tasks" data-action="overdue"><strong>${openTasks().filter(overdue).length}</strong> Overdue follow-ups</a></div>
    <div id="map-panel">${mapPanel()}</div>
    <section class="panel directory"><div class="panel-head"><h2>Organizations</h2><div class="actions">${button('import', 'Import CSV')} ${button('export', 'Export CSV')}</div></div>
    <div class="filters">
      <label>Search<input data-filter="q" type="search" placeholder="Name, city, or program" value="${escape(filter.q)}"></label>
      ${[['state','State',stateOptions], ['type','Type',types], ['focus','Focus',focuses], ['status','Status',statusOptions], ['sort','Sort by',[['name','Name'],['contact','Last contact']]]].map(([key, label, items]) => `<label>${label}<select data-filter="${key}">${options(key === 'sort' ? items : [['','All'], ...items], filter[key])}</select></label>`).join('')}
    </div><div id="directory-table">${directoryTable()}</div></section>`;
}

function organizationFields(org = {}, includeStatus = true) {
  return textField('name', 'Organization name', org.name, 'text', true) + selectField('type', 'Type', types, org.type) +
    selectField('focus', 'Program focus', focuses, org.focus) + selectField('scope', 'Scope', scopes, org.scope) +
    selectField('state', 'State', [['','Choose state'], ...stateOptions], org.state) + textField('city', 'City', org.city) +
    textField('address', 'Street address', org.address) + textField('website', 'Website', org.website, 'url') +
    textField('email', 'Email', org.email, 'email') + textField('phone', 'Phone', org.phone, 'tel') +
    (includeStatus ? selectField('status', 'Status', statusOptions, org.status || 'unreached') : '') +
    area('summary', 'Program details', org.summary);
}

const sections = { 'Staff / Contacts': 'contacts', Interactions: 'interactions', Tasks: 'tasks', Notes: 'notes', Signups: 'signups' };
const sectionLabels = { contacts: 'contact', interactions: 'interaction', tasks: 'task', notes: 'note', signups: 'signup' };

function entryFields(section, entry = {}) {
  switch (section) {
    case 'contacts': return textField('name', 'Name', entry.name, 'text', true) + textField('role', 'Role', entry.role) +
      textField('email', 'Email', entry.email, 'email') + textField('phone', 'Phone', entry.phone, 'tel');
    case 'interactions': return selectField('type', 'Interaction type', enumOptions(interactions), entry.type || 'meeting') +
      textField('date', 'Date', entry.date || today(), 'date', true) + textField('subject', 'Subject', entry.subject, 'text', true) +
      area('notes', 'Notes', entry.notes) + (entry.id ? '' : '<label class="wide inline"><input name="suggest" type="checkbox" checked> Review suggested follow-up after saving</label>');
    case 'tasks': return textField('title', 'Task', entry.title, 'text', true) + textField('owner', 'Assigned to', entry.owner) +
      textField('dueDate', 'Due date', entry.dueDate, 'date') + selectField('priority', 'Priority', enumOptions(priorities), entry.priority || 'medium') +
      selectField('status', 'Status', enumOptions(taskStatuses), entry.status || 'open');
    case 'notes': return area('text', 'Note', entry.text);
    case 'signups': return textField('name', 'Name', entry.name, 'text', true) + textField('email', 'Email', entry.email, 'email') +
      textField('interest', 'Interest', entry.interest) + selectField('status', 'Status', ['New', 'Needs follow-up', 'Connected'], entry.status);
  }
}

function entryList(entries, section, showOrg = false) {
  if (!entries.length) return empty(`No ${section} to show.`);
  return `<div class="entries">${entries.map(entry => {
    const title = entry.name || entry.subject || entry.title || 'Note';
    const metadata = {
      contacts: [entry.role, entry.email, entry.phone],
      interactions: [interactions[entry.type]?.label, entry.date],
      tasks: [entry.owner, entry.dueDate && `Due ${entry.dueDate}`, priorities[entry.priority]?.label, overdue(entry) ? 'Overdue' : taskStatuses[entry.status]?.label],
      notes: [entry.createdOn],
      signups: [entry.email, entry.interest, entry.status],
    }[section].filter(Boolean).map(escape).join(' · ');
    return `<article><div><h3>${escape(title)}</h3><p>${showOrg ? orgLink(orgById(entry.org)) + (metadata ? ' · ' : '') : ''}${metadata}</p>${entry.notes || entry.text ? `<p class="note">${escape(entry.notes || entry.text)}</p>` : ''}</div>
      <div class="actions">${section === 'tasks' && entry.status !== 'completed' ? button('complete-task', 'Complete', `data-id="${entry.id}"`) : ''}${button('edit-entry','Edit',`data-id="${entry.id}"`)}${showOrg ? '' : button('delete-entry','Remove',`data-id="${entry.id}"`)}</div></article>`;
  }).join('')}</div>`;
}

function profile(org) {
  if (!org) return '<p>Organization not found. <a href="#directory">Back to directory</a></p>';
  const section = sections[selectedSection];
  const details = [['Address', [org.address, org.city, org.state].filter(Boolean).join(', ')], ['Website', org.website], ['Email', org.email], ['Phone', org.phone], ['Last contact', lastContact(org.id) || 'Never'], ['Discovered', org.discoveredOn], ['Source', org.source]];
  return `<a class="back" href="#directory">← Directory</a>` + headline(escape(org.name), escape([org.type, org.focus, org.scope, states[org.state].name].join(' · ')),
    button('edit-org', 'Edit profile') + button('log', 'Log interaction', 'class="primary"')) +
    `<div class="profile-status"><label>Status<select id="org-status">${options(statusOptions, org.status)}</select></label></div>
    <div class="tabs" aria-label="Profile sections">${['Overview', ...Object.keys(sections)].map(label => button('section', label, `data-section="${label}" aria-pressed="${selectedSection === label}"`)).join('')}</div>
    <section class="panel"><div class="panel-head"><h2>${selectedSection}</h2>${section ? button('new-entry', 'Add ' + sectionLabels[section], `data-section="${section}" class="primary"`) : ''}</div>
      ${section ? entryList(getEntries(section).filter(entry => entry.org === org.id).reverse(), section) :
        `<dl>${details.filter(([, value]) => value).map(([label, value]) => `<div><dt>${label}</dt><dd>${['Website','Source'].includes(label) ? `<a href="${escape(value)}" target="_blank" rel="noopener noreferrer">${escape(value)}</a>` : escape(value)}</dd></div>`).join('')}</dl>
        ${org.summary ? `<p class="note">${escape(org.summary)}</p>` : ''}`}
    </section>`;
}

function tasksPage() {
  const rows = taskFilter === 'all' ? getEntries('tasks') : taskFilter === 'overdue' ? openTasks().filter(overdue) : openTasks();
  rows.sort((a, b) => (a.dueDate || '9999').localeCompare(b.dueDate || '9999'));
  return headline('Follow-ups', 'Review open, overdue, and completed outreach tasks.') +
    `<section class="panel"><div class="tabs">${[['open','Open'],['overdue','Overdue'],['all','All']].map(([value,label]) => button('task-filter', label, `data-value="${value}" aria-pressed="${taskFilter === value}"`)).join('')}</div>${entryList(rows, 'tasks', true)}</section>`;
}

function signupsPage() {
  const rows = getEntries('signups').filter(entry => signupFilter === 'All' || entry.status === signupFilter);
  return headline('Signups', 'View signup interests and follow-up status across organizations.', button('export-signups', 'Export CSV')) +
    `<section class="panel"><div class="tabs">${['All','New','Needs follow-up','Connected'].map(label => button('signup-filter', label, `data-value="${label}" aria-pressed="${signupFilter === label}"`)).join('')}</div>${entryList(rows, 'signups', true)}</section>`;
}

function reportRows() {
  const counts = countsAt(data.organizations, today());
  return stateOptions.map(([code, state]) => ({
    state, organizations: data.organizations.filter(org => org.state === code).length, partners: counts[code] || 0,
    interactions: getEntries('interactions').filter(entry => orgById(entry.org)?.state === code).length,
    openTasks: openTasks().filter(entry => orgById(entry.org)?.state === code).length,
  })).filter(row => row.organizations);
}

function reportsPage() {
  const rows = reportRows();
  return headline('Outreach reports', 'Compare outreach and partnerships by state.', button('export-report', 'Export CSV')) +
    `<section class="panel"><h2>State totals</h2>${rows.length ? `<div class="table-wrap"><table><thead><tr><th>State</th><th>Organizations</th><th>Active partners</th><th>Interactions</th><th>Open tasks</th></tr></thead><tbody>${rows.map(row => `<tr>${Object.values(row).map(value => `<td>${escape(value)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>` : empty('State totals will appear when organizations are added.')}</section>`;
}

function discoveryPage() {
  return headline('Organization discovery', data.discoveryEnabled ? `Runs daily at ${String(data.discoveryHour).padStart(2,'0')}:00 Eastern. Review candidates before adding them to outreach.` : 'Set DISCOVERY_SOURCE=swan or configure BRAVE_SEARCH_API_KEY on the server to enable daily discovery.') +
    `<section class="panel"><h2>Review queue</h2>${data.candidates.length ? `<div class="entries">${data.candidates.map(item => `<article><div><h3>${escape(item.name)}</h3><p>${states[item.state].name} · Found ${item.discoveredOn}</p><p>${escape(item.summary)}</p><a href="${escape(item.source)}" target="_blank" rel="noopener noreferrer">View source</a></div><div class="actions">${button('approve','Review',`data-id="${item.id}" class="primary"`)}${button('dismiss','Dismiss',`data-id="${item.id}"`)}</div></article>`).join('')}</div>` : empty('No candidates waiting for review.')}</section>
    <section class="panel"><h2>Run history</h2>${data.runs.length ? `<ul>${data.runs.map(run => `<li>${run.day} · ${escape(run.status)}${run.area ? ' · ' + escape(run.area) : ''}${run.added !== undefined ? ` · ${run.added} new candidates` : ''}${run.error ? ` · ${escape(run.error)}` : ''}</li>`).join('')}</ul>` : empty('No discovery runs yet.')}</section>`;
}

function render() {
  const [page, id] = (location.hash.slice(1) || 'directory').split('/');
  if (id !== selectedId) selectedSection = 'Overview';
  selectedId = id;
  if (page !== 'directory' && playback) {
    clearInterval(playback);
    playback = null;
  }
  const views = { directory, tasks: tasksPage, signups: signupsPage, reports: reportsPage, discovery: discoveryPage };
  app.innerHTML = page === 'organization' ? profile(orgById(id)) : (views[page] || directory)();
  document.querySelectorAll('nav a').forEach(link => {
    if (link.hash === '#' + (page === 'organization' ? 'directory' : page)) link.setAttribute('aria-current','page');
    else link.removeAttribute('aria-current');
  });
}

function refreshMap() {
  const panel = document.querySelector('#map-panel');
  if (panel) panel.innerHTML = mapPanel();
}

async function refresh() {
  data = await request();
  render();
}

function edit(title, fields, save, label = 'Save') {
  if (dialog.open) dialog.close();
  dialog.innerHTML = `<form><div class="panel-head"><h2>${title}</h2><button type="button" data-close aria-label="Close">×</button></div>
    <div class="fields">${fields}</div><p class="error" role="alert"></p><div class="actions end"><button type="button" data-close>Cancel</button><button class="primary" type="submit">${label}</button></div></form>`;
  dialog.setAttribute('aria-label', title);
  const form = dialog.querySelector('form');
  dialog.querySelectorAll('[data-close]').forEach(control => control.addEventListener('click', () => dialog.close()));
  form.addEventListener('submit', async event => {
    event.preventDefault();
    const submit = event.submitter;
    submit.disabled = true;
    try {
      const next = await save(Object.fromEntries(new FormData(form)));
      dialog.close();
      try {
        await refresh();
      } catch {
        reportError('The change was saved, but the workspace could not refresh. Reload the page.');
      }
      next?.();
    } catch (error) {
      form.querySelector('.error').textContent = error.message;
    } finally {
      submit.disabled = false;
    }
  });
  dialog.showModal();
}

function editOrg(org) {
  edit(org ? 'Edit organization' : 'Add organization', organizationFields(org), async values => {
    await request(org ? '/organizations/' + org.id : '/organizations', org ? 'PUT' : 'POST', values);
  });
}

function editEntry(org, section, entry) {
  const label = sectionLabels[section];
  edit(entry?.id ? 'Edit ' + label : 'Add ' + label, entryFields(section, entry), async values => {
    await request(`/organizations/${org}/${section}${entry?.id ? '/' + entry.id : ''}`, entry?.id ? 'PUT' : 'POST', values);
    if (section === 'interactions' && values.suggest) {
      const suggestion = suggestFromInteractionNotes(values.notes, today()).followUp;
      if (suggestion) return () => editEntry(org, 'tasks', suggestion);
    }
  });
}

function reportError(message) {
  let notice = document.querySelector('#notice');
  if (!notice) {
    notice = document.createElement('p');
    notice.id = 'notice';
    notice.className = 'error';
    notice.setAttribute('role', 'alert');
    app.prepend(notice);
  }
  notice.textContent = message;
}

function setDirectoryFilter(key, value) {
  filter[key] = value;
  const input = document.querySelector(`[data-filter="${key}"]`);
  if (input) input.value = value;
  const table = document.querySelector('#directory-table');
  if (table) table.innerHTML = directoryTable();
}

app.addEventListener('input', event => {
  const input = event.target;
  if (input.dataset.filter === 'q') setDirectoryFilter('q', input.value);
  if (input.id === 'history') {
    dateIndex = Number(input.value);
    const panel = document.querySelector('#map-panel');
    const existing = input;
    refreshMap();
    // Keep the active range control in place while the user drags it.
    const replacement = panel.querySelector('#history');
    replacement.replaceWith(existing);
    existing.focus();
  }
});

app.addEventListener('change', async event => {
  const input = event.target;
  try {
    if (input.dataset.filter && input.dataset.filter !== 'q') {
      setDirectoryFilter(input.dataset.filter, input.value);
      if (input.dataset.filter === 'state') refreshMap();
    }
    if (input.id === 'org-status') {
      const org = orgById(selectedId);
      await request('/organizations/' + org.id, 'PUT', { ...org, status: input.value });
      await refresh();
    }
  } catch (error) {
    if (input.id === 'org-status') input.value = orgById(selectedId).status;
    reportError(error.message);
  }
});

app.addEventListener('click', async event => {
  const control = event.target.closest('[data-action]');
  if (!control) return;
  const { action, id, section, state, value } = control.dataset;
  const entry = data.entries.find(item => item.id === id);
  const org = orgById(selectedId);
  try {
    switch (action) {
      case 'state':
        event.preventDefault();
        setDirectoryFilter('state', filter.state === state ? '' : state);
        refreshMap();
        document.querySelector('.directory').scrollIntoView({ block: 'start' });
        break;
      case 'play': {
        if (playback) {
          clearInterval(playback);
          playback = null;
        } else {
          dateIndex = 0;
          playback = setInterval(() => {
            if (++dateIndex >= mapDates().length - 1) {
              clearInterval(playback);
              playback = null;
            }
            refreshMap();
          }, 850);
        }
        refreshMap();
        break;
      }
      case 'partners':
        event.preventDefault();
        setDirectoryFilter('status', filter.status === 'partnering' ? '' : 'partnering');
        document.querySelector('.directory').scrollIntoView({ block: 'start' });
        break;
      case 'open-tasks': taskFilter = 'open'; break;
      case 'overdue': taskFilter = 'overdue'; break;
      case 'task-filter': taskFilter = value; render(); break;
      case 'signup-filter': signupFilter = value; render(); break;
      case 'section': selectedSection = section; render(); break;
      case 'new-org': editOrg(); break;
      case 'edit-org': editOrg(org); break;
      case 'log': editEntry(org.id, 'interactions'); break;
      case 'new-entry': editEntry(org.id, section); break;
      case 'edit-entry': editEntry(entry.org, entry.section, entry); break;
      case 'complete-task':
        await request(`/organizations/${entry.org}/tasks/${entry.id}`, 'PUT', { status: 'completed' });
        await refresh();
        break;
      case 'delete-entry':
        edit('Remove ' + sectionLabels[entry.section], '<p class="wide">Remove this entry from the organization profile?</p>', async () => {
          await request(`/organizations/${entry.org}/${entry.section}/${entry.id}`, 'DELETE');
        }, 'Remove');
        break;
      case 'export': downloadCsv('organizations.csv', csvFields, filteredOrganizations()); break;
      case 'export-report': downloadCsv('outreach-by-state.csv', ['state','organizations','partners','interactions','openTasks'], reportRows()); break;
      case 'export-signups': downloadCsv('signups.csv', ['organization','name','email','interest','status'], getEntries('signups').map(item => ({ ...item, organization: orgById(item.org).name }))); break;
      case 'import':
        edit('Import organizations', '<p class="wide">Use a CSV with columns name, type, focus, scope, and state. Use two-letter state codes and the same type, focus, and scope values as the organization form.</p><label class="wide">CSV file<input name="file" type="file" accept=".csv,text/csv" required></label>', async ({ file }) => {
          if (file.size > 1_000_000) throw new Error('Choose a file smaller than 1 MB.');
          const rows = parseCsv(await file.text());
          if (!rows.length) throw new Error('The file contains no organizations.');
          await request('/import', 'POST', rows);
        }, 'Import');
        break;
      case 'approve': {
        const candidate = data.candidates.find(item => item.id === id);
        edit('Review discovered organization', organizationFields(candidate, false), async values => {
          await request('/candidates/' + id, 'POST', { ...values, action: 'approve' });
        }, 'Add as unreached');
        break;
      }
      case 'dismiss':
        edit('Dismiss candidate', '<p class="wide">Remove this candidate from the review queue?</p>', async () => {
          await request('/candidates/' + id, 'POST', { action: 'dismiss' });
        }, 'Dismiss');
        break;
    }
  } catch (error) {
    reportError(error.message);
  }
});

window.addEventListener('hashchange', () => {
  render();
  window.scrollTo(0, 0);
});
refresh().catch(error => reportError(error.message));
loadMap().then(result => { map = result; refreshMap(); }).catch(error => { mapError = error.message; refreshMap(); });

setInterval(async () => {
  if (location.hash !== '#discovery' || dialog.open) return;
  try {
    const next = await request();
    if (location.hash === '#discovery' && !dialog.open &&
      JSON.stringify([next.candidates, next.runs]) !== JSON.stringify([data.candidates, data.runs])) {
      data = next;
      render();
    }
  } catch {
    // Keep the current results visible during transient connection failures.
  }
}, 30_000);
