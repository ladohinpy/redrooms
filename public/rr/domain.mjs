/** Pure domain rules. Shared by tests, administrator UI and Telegram backend.
 * No Telegram IDs, credentials, DOM, SDK or network dependencies here. */
export const LIMITS = Object.freeze({ fileBytes: 1048576, stateBytes: 4194304, directors: 12, films: 500, perDirector: 300, title: 140, catalogs: 30, releases: 100, audit: 200 });
export class DomainError extends Error {
  constructor(message, code = 'VALIDATION') { super(message); this.name = 'DomainError'; this.code = code; }
}
export function fail(message, code) { throw new DomainError(message, code); }
export const clone = value => JSON.parse(JSON.stringify(value));
export function byteLength(text) { let n = 0; for (const c of text) { const p = c.codePointAt(0); n += p < 128 ? 1 : p < 2048 ? 2 : p < 65536 ? 3 : 4; } return n; }
export function object(value, label = 'Объект') { if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${label}: нужен объект.`); return value; }
export function id(value, label = 'ID') {
  if (typeof value !== 'string' || !/^[a-z0-9][a-z0-9_-]{0,63}$/.test(value)) fail(`${label}: 1–64 символа a–z, 0–9, _ или -, первый — буква или цифра.`);
  return value;
}
export function label(value, field, max = 140) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > max || /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(value)) fail(`${field}: непустой текст до ${max} символов, без управляющих символов.`);
  return value.trim();
}
function unique(values, what) { if (new Set(values).size !== values.length) fail(`Повторяются ID: ${what}.`, 'DUPLICATE'); }
export function normalizeCatalog(raw, defaultStatus = 'pending') {
  object(raw, 'Каталог');
  if (raw.schemaVersion !== 1) fail('Поддерживается только schemaVersion: 1.');
  if (byteLength(JSON.stringify(raw)) > LIMITS.fileBytes) fail('Каталог превышает 1 МиБ.', 'TOO_LARGE');
  if (!Array.isArray(raw.directors) || raw.directors.length > LIMITS.directors) fail('Допустимо не более 12 режиссёров.');
  const pack = { schemaVersion: 1, id: id(raw.id, 'ID набора'), name: label(raw.name, 'Название набора', 100), directors: [] };
  const allFilmIds = [];
  for (const d0 of raw.directors) {
    object(d0, 'Режиссёр');
    if (d0.enabled !== undefined && typeof d0.enabled !== 'boolean') fail('enabled режиссёра должен быть boolean.');
    if (!Array.isArray(d0.films) || d0.films.length > LIMITS.perDirector) fail('У режиссёра может быть не более 300 фильмов.');
    const d = { id: id(d0.id, 'ID режиссёра'), name: label(d0.name, 'Имя режиссёра', 64), enabled: d0.enabled !== false, films: [] };
    for (const f0 of d0.films) {
      object(f0, 'Фильм');
      const status = f0.status === undefined ? defaultStatus : f0.status;
      if (!['pending', 'approved', 'excluded'].includes(status)) fail('Статус фильма: pending, approved или excluded.');
      if (!Number.isInteger(f0.year) || f0.year < 1800 || f0.year > 2100) fail('Год должен быть целым числом от 1800 до 2100.');
      const f = { id: id(f0.id, 'ID фильма'), title: label(f0.title, 'Название фильма'), year: f0.year, original: label(f0.original === undefined ? f0.title : f0.original, 'Оригинальное название'), status };
      allFilmIds.push(f.id); d.films.push(f);
    }
    pack.directors.push(d);
  }
  unique(pack.directors.map(d => d.id), 'режиссёры'); unique(allFilmIds, 'фильмы');
  if (allFilmIds.length > LIMITS.films) fail('В каталоге может быть не более 500 фильмов.');
  return pack;
}
export function catalogWarnings(pack) {
  const warnings = [], seen = new Set();
  for (const d of pack.directors) for (const f of d.films) {
    const key = `${f.title.normalize('NFC').trim().toLocaleLowerCase('ru')}|${f.year}`;
    if (seen.has(key)) warnings.push(`Возможный дубль: «${f.title}», ${f.year}. Проверьте вручную.`);
    seen.add(key);
  }
  return warnings;
}
export function playableCatalog(raw) {
  const p = normalizeCatalog(raw), directors = [];
  for (const d of p.directors) {
    if (!d.enabled) continue;
    if (d.films.some(f => f.status === 'pending')) fail(`У ${d.name} остались фильмы на модерации. Одобрите или исключите их.`, 'PENDING_REVIEW');
    const films = d.films.filter(f => f.status === 'approved').map(({status, ...f}) => f);
    if (films.length) directors.push({ id: d.id, name: d.name, films });
  }
  if (!directors.length) fail('Для публикации нужен хотя бы один включённый режиссёр с одобренным фильмом.');
  return { schemaVersion: 1, id: p.id, name: p.name, directors };
}
export function totals(pack) { return { directors: pack.directors.length, films: pack.directors.reduce((n,d) => n+d.films.length, 0), pending: pack.directors.reduce((n,d) => n+d.films.filter(f => f.status === 'pending').length, 0) }; }
export function gameBuild(game) {
  object(game, 'Сборка'); id(game.id, 'ID сборки');
  if (typeof game.entry !== 'string' || !/^\/games\/[a-z0-9_-]+\/[a-f0-9]{16}\/index\.html$/.test(game.entry)) fail('Недопустимый путь игровой сборки.');
  if (!/^[a-f0-9]{64}$/.test(game.codeHash)) fail('У сборки отсутствует SHA-256.');
  if (game.catalogSchemaVersion !== 1) fail('Сборка должна поддерживать схему каталога 1.');
  const aliases = game.aliases || []; if (!Array.isArray(aliases)) fail('aliases должен быть массивом.'); aliases.forEach(a => id(a, 'Псевдоним сборки'));
  return { id: game.id, name: label(game.name, 'Название сборки', 100), entry: game.entry, codeHash: game.codeHash, catalogSchemaVersion: 1, aliases };
}
export function createInitialState(seed, games, now) {
  const builds = games.map(gameBuild); unique(builds.flatMap(g => [g.id, ...g.aliases]), 'версии / псевдонимы сборок'); if (!builds.length) fail('Нет сборок.');
  const catalog = normalizeCatalog(seed, 'approved'), playable = playableCatalog(catalog);
  const game = builds.find(g => g.id === 'v06') || builds[0];
  return {
    schemaVersion: 1,
    game_versions: builds,
    catalog_versions: [{ id: 'original-201-v1', name: 'Исходная коллекция v06', status: 'published', revision: 1, catalog, playable, createdAt: now, updatedAt: now, updatedBy: 'bootstrap' }],
    game_releases: [{ id: 'classic-1', name: 'Классическая Красная комната', gameVersionId: game.id, catalogVersionId: 'original-201-v1', codeHash: game.codeHash, status: 'published', visibility: 'public', createdAt: now, updatedAt: now }],
    app_settings: { defaultReleaseId: 'classic-1', gameDefaults: [{ gameVersionId: game.id, releaseId: 'classic-1' }] },
    audit: [{ at: now, actor: 'bootstrap', action: 'initialize', target: 'classic-1', summary: 'Исходная игра сохранена как первый релиз.' }]
  };
}
function find(items, key, what) { return items.find(x => x.id === key) || fail(`${what} не найден.`, 'NOT_FOUND'); }
function editable(state, key) { const c = find(state.catalog_versions, id(key), 'Каталог'); if (c.status !== 'draft') fail('Опубликованная коллекция неизменяема. Создайте копию-черновик.', 'IMMUTABLE'); return c; }
function compatible(state, release, available) {
  const game = find(state.game_versions, release.gameVersionId, 'Сборка');
  const deployed = available.find(g => g.id === game.id && g.codeHash === release.codeHash && g.entry === game.entry);
  if (!deployed) fail('Нужная сборка не включена в текущий деплой. Верните её файлы; не подменяйте версию другой сборкой.', 'BUILD_UNAVAILABLE');
  const cat = find(state.catalog_versions, release.catalogVersionId, 'Коллекция');
  if (cat.status !== 'published' || !cat.playable || cat.playable.schemaVersion !== game.catalogSchemaVersion) fail('Релиз требует опубликованную совместимую коллекцию.', 'INCOMPATIBLE');
  return { game, cat };
}
/** One command transforms one state document. Caller performs a single DB CAS. */
export function applyCommand(original, command, actor, availableGames, now = new Date().toISOString()) {
  object(command, 'Команда');
  const s = clone(original), input = object(command.input || {}, 'Данные');
  const available = availableGames.map(gameBuild); let target = '', summary = '';
  switch (command.action) {
    case 'createCatalog': {
      target = id(input.id, 'ID версии каталога');
      if (s.catalog_versions.some(c => c.id === target)) fail('ID версии каталога уже занят.', 'DUPLICATE');
      if (s.catalog_versions.length >= LIMITS.catalogs) fail('Достигнут предел 30 версий каталога. Экспортируйте резервную копию и расширьте хранилище.', 'CAPACITY');
      const catalog = normalizeCatalog(input.catalog);
      s.catalog_versions.push({ id: target, name: label(input.name, 'Название версии', 100), status: 'draft', revision: 1, catalog, playable: null, createdAt: now, updatedAt: now, updatedBy: String(actor) }); summary = 'Создан черновик'; break;
    }
    case 'cloneCatalog': {
      const from = find(s.catalog_versions, id(input.sourceId), 'Каталог'); target = id(input.id);
      if (s.catalog_versions.some(c => c.id === target)) fail('ID версии каталога уже занят.', 'DUPLICATE');
      if (s.catalog_versions.length >= LIMITS.catalogs) fail('Достигнут предел 30 версий каталога.', 'CAPACITY');
      s.catalog_versions.push({ id: target, name: label(input.name, 'Название версии', 100), status: 'draft', revision: 1, catalog: clone(from.catalog), playable: null, createdAt: now, updatedAt: now, updatedBy: String(actor) }); summary = `Копия ${from.id}`; break;
    }
    case 'saveCatalog': {
      const c = editable(s, input.id); target = c.id; c.catalog = normalizeCatalog(input.catalog); c.name = label(input.name, 'Название версии', 100); c.revision++; c.updatedAt = now; c.updatedBy = String(actor); summary = 'Сохранён черновик'; break;
    }
    case 'publishCatalog': {
      const c = editable(s, input.id); target = c.id; c.playable = playableCatalog(c.catalog); c.status = 'published'; c.revision++; c.updatedAt = now; c.updatedBy = String(actor); summary = 'Коллекция зафиксирована для релизов'; break;
    }
    case 'syncGames': {
      const names = available.flatMap(g => [g.id, ...g.aliases]); unique(names, 'версии / псевдонимы сборок');
      for (const g of available) {
        const old = s.game_versions.find(x => x.id === g.id);
        if (old && (old.codeHash !== g.codeHash || old.entry !== g.entry)) fail(`Нельзя переписать код сборки ${g.id}. Создайте новый ID.`, 'IMMUTABLE');
        if (!old) s.game_versions.push(g);
      }
      target = 'game_versions'; summary = 'Зарегистрированы загруженные разработчиком сборки'; break;
    }
    case 'createRelease': {
      target = id(input.id, 'ID релиза'); if (s.game_releases.some(r => r.id === target)) fail('ID релиза занят.', 'DUPLICATE');
      if (s.game_releases.length >= LIMITS.releases) fail('Достигнут предел 100 релизов.', 'CAPACITY');
      const g = find(s.game_versions, id(input.gameVersionId), 'Сборка');
      const r = { id: target, name: label(input.name, 'Название релиза', 100), gameVersionId: g.id, catalogVersionId: id(input.catalogVersionId), codeHash: g.codeHash, status: 'draft', visibility: 'unlisted', createdAt: now, updatedAt: now };
      compatible(s, r, available); s.game_releases.push(r); summary = 'Релиз создан для предпросмотра администраторов'; break;
    }
    case 'publishRelease': {
      const r = find(s.game_releases, id(input.id), 'Релиз'); target = r.id;
      if (r.status !== 'draft') fail('Опубликовать можно только черновик релиза.', 'BAD_STATE');
      if (!['public', 'unlisted'].includes(input.visibility)) fail('Видимость: public или unlisted.');
      compatible(s,r,available); r.status = 'published'; r.visibility = input.visibility; r.updatedAt = now;
      if (!s.app_settings.gameDefaults.some(d => d.gameVersionId === r.gameVersionId)) s.app_settings.gameDefaults.push({ gameVersionId: r.gameVersionId, releaseId: r.id });
      summary = 'Релиз опубликован; основная версия не изменена'; break;
    }
    case 'setDefault': {
      const r = find(s.game_releases,id(input.id),'Релиз'); target = r.id;
      if (r.status !== 'published') fail('Основным может быть только опубликованный релиз.', 'NOT_PUBLISHED');
      compatible(s,r,available);
      s.app_settings.defaultReleaseId = r.id;
      s.app_settings.gameDefaults = s.app_settings.gameDefaults.filter(d => d.gameVersionId !== r.gameVersionId);
      s.app_settings.gameDefaults.push({ gameVersionId: r.gameVersionId, releaseId: r.id });
      summary = 'Выбран основной релиз для новых обычных запусков'; break;
    }
    case 'setGameDefault': {
      const r = find(s.game_releases,id(input.id),'Релиз'); target = r.id;
      if (r.status !== 'published') fail('Нужен опубликованный релиз.'); compatible(s,r,available);
      s.app_settings.gameDefaults = s.app_settings.gameDefaults.filter(d => d.gameVersionId !== r.gameVersionId);
      s.app_settings.gameDefaults.push({ gameVersionId: r.gameVersionId, releaseId: r.id }); summary = 'Выбран релиз для параметра game'; break;
    }
    case 'archiveRelease': {
      const r = find(s.game_releases,id(input.id),'Релиз'); target = r.id;
      if (s.app_settings.defaultReleaseId === r.id || s.app_settings.gameDefaults.some(d => d.releaseId === r.id)) fail('Сначала переключите основной релиз и выбор для game на другую версию.', 'DEFAULT_IN_USE');
      if (r.status === 'archived') fail('Релиз уже в архиве.'); r.status = 'archived'; r.updatedAt = now; summary = 'Релиз закрыт для новых запусков'; break;
    }
    case 'restoreRelease': {
      const r = find(s.game_releases,id(input.id),'Релиз'); target = r.id;
      if (r.status !== 'archived') fail('Релиз не в архиве.'); compatible(s,r,available); r.status = 'draft'; r.updatedAt = now; summary = 'Релиз возвращён в предпросмотр (публикация отдельно)'; break;
    }
    default: fail('Неизвестная команда.', 'UNKNOWN_COMMAND');
  }
  s.audit.push({ at: now, actor: String(actor), action: command.action, target, summary }); s.audit = s.audit.slice(-LIMITS.audit);
  if (byteLength(JSON.stringify(s)) > LIMITS.stateBytes) fail('Хранилище MVP достигло 4 МиБ. Изменение не сохранено; нужен перенос на построчную модель.', 'CAPACITY');
  return s;
}
export function parseSelector({ release, game, startParam } = {}) {
  if (release !== undefined && release !== null) return { kind: 'release', value: id(release, 'release') };
  if (game !== undefined && game !== null) return { kind: 'game', value: id(game, 'game') };
  if (startParam === 'admin') return { kind: 'admin' };
  if (typeof startParam === 'string' && startParam.startsWith('release_')) return { kind: 'release', value: id(startParam.slice(8), 'startapp release') };
  if (typeof startParam === 'string' && startParam.startsWith('game_')) return { kind: 'game', value: id(startParam.slice(5), 'startapp game') };
  if (startParam && typeof startParam === 'string' && /^(release|game)(_|$)/.test(startParam)) fail('Некорректный параметр запуска.');
  return { kind: 'default' }; // Non-version campaign tags do not grant access.
}
export function resolveLaunch(state, selector, isAdmin, availableGames) {
  let rid;
  if (selector.kind === 'admin') return { admin: true };
  if (selector.kind === 'release') rid = selector.value;
  else if (selector.kind === 'game') {
    const g = state.game_versions.find(g => g.id === selector.value || g.aliases.includes(selector.value));
    if (!g) fail('Версия игры не найдена.', 'NOT_FOUND');
    rid = state.app_settings.gameDefaults.find(d => d.gameVersionId === g.id)?.releaseId;
    if (!rid) fail('Для этой версии ещё не назначен опубликованный релиз.', 'NOT_FOUND');
  } else rid = state.app_settings.defaultReleaseId;
  const r = state.game_releases.find(r => r.id === rid);
  if (!r || r.status === 'archived' || (r.status !== 'published' && !isAdmin)) fail('Релиз не найден или недоступен.', 'NOT_FOUND');
  const { game, cat } = compatible(state,r,availableGames);
  return { release: clone(r), game: clone(game), catalog: clone(cat.playable), defaultReleaseId: state.app_settings.defaultReleaseId, preview: r.status === 'draft' };
}
