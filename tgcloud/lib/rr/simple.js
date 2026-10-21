/** The four-table editor is a view over the existing catalog, not a second database. */
export const SIMPLE_BUILD = 'v07-tables';
export const SIMPLE_VERSION = 'tables-admin-2';
const fail = message => { const e = new Error(message); e.name = 'DomainError'; e.code = 'VALIDATION'; throw e; };
const key = text => text.normalize('NFC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('ru');
export function splitTitles(text, delimiter = 'auto') {
  if (typeof text !== 'string' || text.length > 100000) fail('Список кассет должен быть текстом разумного размера.');
  if (!['auto','lines','semicolon','comma'].includes(delimiter)) fail('Неизвестный разделитель.');
  const mode = delimiter === 'auto' ? (/\r|\n/.test(text) ? 'lines' : text.includes(';') ? 'semicolon' : 'lines') : delimiter;
  // Commas are NEVER guessed: «Однажды, ...» is a valid movie title.
  const separator = { lines: /\r\n|\r|\n/, semicolon: /[;\r\n]+/, comma: /[,\r\n]+/ }[mode];
  return text.replace(/^\uFEFF/,'').split(separator).map(t => t.trim()).filter(Boolean);
}
export function catalogToRows(catalog) {
  const ds = catalog?.directors || [];
  if (ds.length > 4) fail('В этом каталоге больше четырёх столов. Используйте подробный редактор или создайте новый набор.');
  return Array.from({length:4}, (_,i) => ({
    name: ds[i]?.name || '',
    titles: (ds[i]?.films || []).filter(f => f.status !== 'excluded').map(f => f.title).join('\n'),
    delimiter: 'lines'
  }));
}
function hash(text) { let n=2166136261; for (let i=0;i<text.length;i++) n=Math.imul(n^text.charCodeAt(i),16777619); return (n>>>0).toString(36); }
export function simpleCatalog({ id, name, tables }, previous, publish = false) {
  if (!Array.isArray(tables) || tables.length !== 4) fail('Нужны ровно четыре строки — по одной на каждый стол.');
  const seenNames = new Set(), seenFilms = new Map(), usedIds = new Set();
  const old = new Map();
  for (const d of previous?.directors || []) for (const f of d.films) if (!old.has(key(f.title))) old.set(key(f.title),f);
  const directors = tables.map((row, i) => {
    if (!row || typeof row.name !== 'string') fail(`Стол ${i+1}: введите название.`);
    const title = row.name.trim();
    if (title.length > 64 || (publish && !title)) fail(`Стол ${i+1}: нужно название до 64 символов.`);
    if (title && seenNames.has(key(title))) fail(`Повторяется название стола «${title}».`);
    if (title) seenNames.add(key(title));
    const names = splitTitles(row.titles, row.delimiter || 'auto');
    if (publish && names.length === 0) fail(`У стола «${title}» нет кассет.`);
    const films = names.map((text,j) => {
      if (text.length > 140) fail(`Стол ${i+1}, кассета ${j+1}: название длиннее 140 символов.`);
      const k=key(text);
      if (seenFilms.has(k)) fail(`«${text}» повторяется (столы ${seenFilms.get(k)} и ${i+1}). В этой игре у кассеты один правильный стол. Уберите дубль или уточните названия.`);
      seenFilms.set(k,i+1);
      const prior=old.get(k);
      let fid=prior?.id || `f-${i+1}-${hash(k)}`; let suffix=1;
      while (usedIds.has(fid)) fid=`f-${i+1}-${hash(k)}-${suffix++}`;
      usedIds.add(fid);
      return { id:fid, title:text, original:prior?.original || text, year:prior?.year ?? null, status:publish?'approved':'pending' };
    });
    // Empty draft captions have neutral stored labels; draft editor can clear them again.
    return {id:previous?.directors?.[i]?.id || `table-${i+1}`, name:title || `Стол ${i+1}`, enabled:true, films};
  });
  return {schemaVersion:1,id,name,directors};
}
export function setLink(botUsername, setId) {
  if (!/^[a-zA-Z0-9_]{5,32}$/.test(botUsername || '')) fail('Не удалось определить имя бота. Обновите панель или укажите username бота без @.');
  if (!/^[a-z0-9][a-z0-9_-]{0,55}$/.test(setId || '')) fail('Для ссылки нужен ID из 1–56 латинских букв, цифр, - или _.');
  return `https://t.me/${botUsername}?startapp=set_${setId}`;
}
