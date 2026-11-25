import { countyForRun, discoverSwan } from './swan-discovery.js';
import { states, today } from '../src/model.js';
import { website, clean } from './store.js';

const opportunity = /foster (care|famil)|adoption|adoptive famil/i;
const blocked = /(^|\.)(facebook|instagram|linkedin|yelp|youtube|reddit|wikipedia)\.com$|\.gov$/i;
const regions = Object.entries(states).filter(([code]) => code !== 'DC');
const dayNumber = day => Math.floor(Date.parse(day) / 86_400_000);

export async function discover({ day, apiKey, fetcher = fetch, pause = () => new Promise(resolve => setTimeout(resolve, 1100)) }) {
  const batchSize = 5;
  const first = (dayNumber(day) * batchSize) % regions.length;
  const results = new Map();
  for (let offset = 0; offset < batchSize; offset++) {
    const [code, state] = regions[(first + offset) % regions.length];

    for (const topic of ['foster care nonprofit church ministry', 'adoption nonprofit family support agency']) {
      const url = new URL('https://api.search.brave.com/res/v1/web/search');
      url.search = new URLSearchParams({ q: `"${state.name}" ${topic}`, count: '10', country: 'us', text_decorations: 'false' });
      const response = await fetcher(url, { headers: { 'X-Subscription-Token': apiKey, Accept: 'application/json' }, signal: AbortSignal.timeout(15000) });
      if (!response.ok) throw new Error(`Search request failed (HTTP ${response.status}).`);
      const body = await response.json();
      for (const hit of body.web?.results || []) {
        const source = website(hit.url);
        const name = clean(hit.profile?.name || hit.title, 180);
        const summary = clean(hit.description, 700);
        if (!source || !name || !opportunity.test(`${name} ${summary}`)) continue;
        const host = new URL(source).hostname.replace(/^www\./, '');
        if (blocked.test(host) || results.has(host)) continue;
        results.set(host, {
          name, source, website: new URL(source).origin, state: code, summary,
          type: /church|ministr(y|ies)/i.test(name) ? 'Church' : /agency/i.test(name) ? 'Agency' : 'Nonprofit',
          focus: /foster/i.test(`${name} ${summary}`) ? (/adopt/i.test(`${name} ${summary}`) ? 'Both' : 'Foster care') : 'Adoption',
          scope: 'Local',
        });
      }
      await pause();
    }
  }
  return [...results.values()];
}

export function scheduleDiscovery(store, apiKey, hour = 6, useSwan = false) {
  if (!apiKey && !useSwan) return;
  async function tick() {
    const day = today();
    const localHour = Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'America/New_York', hour: '2-digit', hourCycle: 'h23' }).format(new Date()));
    if (localHour < hour || !store.claimRun(day)) return;
    try {
      const county = useSwan ? countyForRun(store.completedDiscoveryRuns('swan')) : null;
      const candidates = county ? await discoverSwan(county) : await discover({ day, apiKey });
      const added = store.saveCandidates(candidates);
      store.finishRun({ day, status: 'completed', added, source: county ? 'swan' : 'brave', area: county ? county.name + ' County, PA' : 'United States' });
    } catch (error) {
      store.finishRun({ day, status: 'failed', error: error.message });
      console.error('Discovery failed:', error.message);
    }
  }
  void tick();
  setInterval(tick, 60_000).unref();
}
