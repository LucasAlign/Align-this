import { website, clean } from './store.js';

const base = 'https://www.diakon-swan.org';
const counties = [
  ['Berks', 4], ['Lancaster', 27], ['Lebanon', 60], ['Schuylkill', 40], ['Lehigh', 29], ['Montgomery', 35], ['Chester', 10],
  ['Dauphin', 16], ['Northumberland', 37], ['Columbia', 14], ['Luzerne', 30], ['Carbon', 55], ['Northampton', 36],
  ['Bucks', 6], ['Philadelphia', 39], ['Delaware', 17],
];

export function countyForRun(count) {
  const [name, id] = counties[count % counties.length];
  return { name, id };
}

const entities = { amp: '&', quot: '"', apos: "'", lt: '<', gt: '>', nbsp: ' ' };
const plain = html => html.replace(/<[^>]*>/g, '').replace(/&(#\d+|amp|quot|apos|lt|gt|nbsp);/gi,
  (_, entity) => entity.startsWith('#') ? String.fromCharCode(Number(entity.slice(1))) : entities[entity.toLowerCase()]);

function rows(html) {
  return [...html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)].flatMap(([, row]) => {
    const match = row.match(/<a\s+href="(\/swan\/organization\/\d+\/)">([^<]+)<\/a>/i);
    return match ? [{ path: match[1], name: clean(plain(match[2]), 180), row }] : [];
  });
}

export async function discoverSwan(county, fetcher = fetch) {
  async function read(path) {
    const response = await fetcher(base + path, { signal: AbortSignal.timeout(15000) });
    if (!response.ok) throw new Error(`SWAN directory returned HTTP ${response.status}.`);
    return response.text();
  }
  const [directory, coverage] = await Promise.all([read('/swan/organizations/affiliate/'), read(`/swan/network-map/${county.id}/`)]);
  if (!coverage.includes(`for ${county.name} County`)) throw new Error('SWAN returned an unexpected county page.');
  const affiliates = new Map(rows(directory).map(item => [item.path, item.row]));
  const local = rows(coverage);
  if (!affiliates.size || !local.length) throw new Error('SWAN directory layout changed.');
  return local.filter(({ path }) => affiliates.has(path)).map(({ path, name, row }) => {
    const site = affiliates.get(path).match(/<td class="url">\s*<a href="([^"]+)"/i)?.[1];
    const address = row.match(/<td class="fulladdress">([\s\S]*?)<\/td>/i)?.[1] || '';
    const city = plain(address.split(/<br\s*\/?\s*>/i).at(-1)).match(/(.+),\s*PA\s+\d{5}/)?.[1]?.trim() || '';
    return { name, city, state: 'PA', type: 'Agency', focus: 'Adoption', scope: 'Regional', source: base + path,
      website: site ? website(plain(site)) : '',
      summary: `Pennsylvania Statewide Adoption and Permanency Network affiliate listed as serving ${county.name} County.` };
  });
}
