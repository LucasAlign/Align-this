import { states } from './model.js';

export async function loadMap() {
  const response = await fetch('/us-states.json');
  if (!response.ok) throw new Error('Map boundaries could not load.');
  const { arcs, transform, objects } = await response.json();
  const points = arcs.map(arc => {
    if (!transform) return arc;
    let x = 0;
    let y = 0;
    return arc.map(([dx, dy]) => {
      x += dx;
      y += dy;
      return [x * transform.scale[0] + transform.translate[0], y * transform.scale[1] + transform.translate[1]];
    });
  });
  const byId = new Map(Object.entries(states).map(([code, state]) => [state.fips, code]));
  return objects.states.geometries.filter(shape => byId.has(shape.id)).map(shape => {
    const polygons = shape.type === 'Polygon' ? [shape.arcs] : shape.arcs;
    const path = polygons.flatMap(polygon => polygon.map(ring => {
      const coordinates = ring.flatMap(arc => arc < 0 ? points[~arc].slice().reverse() : points[arc]);
      return 'M' + coordinates.map(pair => pair.map(n => n.toFixed(1)).join(',')).join('L') + 'Z';
    })).join('');
    return { code: byId.get(shape.id), path };
  });
}

export function countsAt(organizations, date) {
  const counts = {};
  for (const organization of organizations) {
    const last = organization.history.findLast(event => event.date <= date);
    if (last?.partnering) counts[last.state] = (counts[last.state] || 0) + 1;
  }
  return counts;
}
