export const csvFields = ['name', 'type', 'focus', 'scope', 'state', 'city', 'address', 'website', 'email', 'phone', 'status', 'summary'];

export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quoted && char === '"' && text[i + 1] === '"') {
      field += '"';
      i++;
    } else if (char === '"') quoted = !quoted;
    else if (!quoted && (char === ',' || char === '\n')) {
      row.push(field.replace(/\r$/, ''));
      field = '';
      if (char === '\n') {
        rows.push(row);
        row = [];
      }
    } else field += char;
  }
  if (quoted) throw new Error('A CSV quote is missing its closing quote.');
  if (field || row.length) rows.push([...row, field.replace(/\r$/, '')]);
  const header = rows.shift()?.map(value => value.trim()) || [];
  if (!['name', 'type', 'focus', 'scope', 'state'].every(key => header.includes(key))) throw new Error('CSV requires name, type, focus, scope, and state columns.');
  return rows.filter(values => values.some(Boolean)).map(values => Object.fromEntries(header.filter(key => csvFields.includes(key)).map(key => [key, values[header.indexOf(key)] || ''])));
}

export function downloadCsv(filename, fields, rows) {
  const quote = input => {
    const value = String(input ?? '');
    const safe = /^[\s]*[=+\-@]|^[\t\r]/.test(value) ? "'" + value : value;
    return '"' + safe.replaceAll('"', '""') + '"';
  };
  const csv = [fields.map(quote).join(','), ...rows.map(row => fields.map(field => quote(row[field])).join(','))].join('\r\n');
  const url = URL.createObjectURL(new Blob(['\uFEFF', csv], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
