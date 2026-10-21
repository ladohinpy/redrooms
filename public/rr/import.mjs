import { normalizeCatalog, LIMITS, byteLength, fail } from './domain.mjs';
/** RFC-style quoted fields; comma, semicolon or tab. No spreadsheet evaluation. */
export function parseCSV(text) {
  if (typeof text !== 'string' || byteLength(text) > LIMITS.fileBytes) fail('CSV должен быть не больше 1 МиБ.');
  text = text.replace(/^\uFEFF/, '');
  const first = text.split(/\r?\n/)[0];
  const delimiter = [';', '\t', ','].sort((a,b) => first.split(b).length - first.split(a).length)[0];
  const rows = []; let row = [], field = '', quoted = false, afterQuote = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) { if (c === '"') { if (text[i+1] === '"') { field += '"'; i++; } else { quoted = false; afterQuote = true; } } else field += c; continue; }
    if (afterQuote && c !== delimiter && c !== '\r' && c !== '\n') fail('CSV: неожиданный символ после закрывающей кавычки.');
    if (c === '"') { if (field) fail('CSV: кавычка внутри неэкранированного поля.'); quoted = true; }
    else if (c === delimiter) { row.push(field); field = ''; afterQuote = false; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i+1] === '\n') i++; row.push(field); if (row.some(v => v.trim())) rows.push(row); row = []; field = ''; afterQuote = false; }
    else field += c;
  }
  if (quoted) fail('CSV: незакрытая кавычка.');
  row.push(field); if (row.some(v => v.trim())) rows.push(row);
  if (rows.length < 2) fail('CSV должен содержать заголовки и хотя бы один фильм.');
  const headers = rows.shift().map(h => h.trim());
  if (new Set(headers).size !== headers.length) fail('CSV: дублирующиеся заголовки.');
  for (const required of ['director_id','director_name','film_id','title','year']) if (!headers.includes(required)) fail(`CSV: нет столбца ${required}.`);
  const allowed = new Set(['director_id','director_name','film_id','title','year','original','status']);
  for (const h of headers) if (!allowed.has(h)) fail(`CSV: неизвестный столбец ${h}.`);
  return rows.map((cells,i) => {
    if (cells.length !== headers.length) fail(`CSV, строка ${i+2}: число полей не совпадает с заголовками.`);
    return Object.fromEntries(headers.map((h,j) => [h, cells[j].trim()]));
  });
}
export function importCatalog(text, kind, { id = 'imported-catalog', name = 'Импортированная коллекция' } = {}) {
  if (byteLength(text) > LIMITS.fileBytes) fail('Файл превышает 1 МиБ.');
  let raw;
  if (kind === 'json') { try { raw = JSON.parse(text.replace(/^\uFEFF/,'')); } catch { fail('Некорректный JSON.'); } }
  else if (kind === 'csv') {
    const directors = [];
    for (const row of parseCSV(text)) {
      let d = directors.find(d => d.id === row.director_id);
      if (!d) { d = { id: row.director_id, name: row.director_name, films: [] }; directors.push(d); }
      if (d.name !== row.director_name) fail(`CSV: одному ID ${d.id} соответствуют разные имена режиссёра.`);
      if (!/^\d{4}$/.test(row.year)) fail(`CSV: год фильма ${row.film_id} должен содержать четыре цифры.`);
      d.films.push({ id: row.film_id, title: row.title, year: Number(row.year), original: row.original || row.title, status: 'pending' });
    }
    raw = { schemaVersion: 1, id, name, directors };
  } else fail('Поддерживаются только JSON и CSV.');
  // Every imported film must be reviewed here, even if the file claims "approved".
  const normalized = normalizeCatalog(raw);
  for (const d of normalized.directors) for (const f of d.films) f.status = 'pending';
  return normalized;
}
const csvCell = value => '"' + String(value).replace(/"/g,'""') + '"';
/** Prevent spreadsheet formula execution when the exported CSV is opened in Excel. */
export function exportCSV(pack) {
  const safe = value => /^[\s\uFEFF]*[=+@\-]|^[\t\r\n]/.test(String(value)) ? "'" + value : value;
  const rows = [['director_id','director_name','film_id','title','year','original','status']];
  for (const d of pack.directors) for (const f of d.films) rows.push([d.id, safe(d.name), f.id, safe(f.title), f.year, safe(f.original), f.status || 'approved']);
  return '\uFEFF' + rows.map(r => r.map(csvCell).join(';')).join('\r\n');
}
