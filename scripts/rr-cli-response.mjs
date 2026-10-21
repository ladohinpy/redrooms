/**
 * Compatibility guard for @tgcloud/cli 0.2.0's deploy response.
 * The observed CLI wrote boolean false from canonical_modules to a file.
 * We do NOT infer whether false means unchanged/deleted and never stringify it.
 * Instead, fetch authoritative full state at the SAME server revision.
 * This helper performs no deploy, migration, deletion, or filesystem writes.
 */
function record(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function fail(message) {
  throw new Error('RR CLI snapshot: ' + message + ' Публикация могла уже примениться; остановка до следующих этапов.');
}
function stringMap(value) {
  return record(value) && Object.values(value).every(source => typeof source === 'string');
}
function revision(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

/**
 * @param {object} response Original successful /deploy response.
 * @param {() => Promise<object>} fetchFullState Read-only GET /get with existing CLI auth.
 * @param {{expectedManifest?: string[], notice?: (message: string) => void}} options
 * @returns {Promise<object>} Original response, or copy with a validated full source map.
 */
export async function normalizeDeployResponse(response, fetchFullState, options = {}) {
  // The CLI allows successful responses without a modules section (static-only).
  if (response == null || !Object.hasOwn(response, 'canonical_modules') || response.canonical_modules == null) {
    return response;
  }
  const sources = response.canonical_modules;
  if (!record(sources)) fail('canonical_modules не является объектом.');
  if (stringMap(sources)) return response;
  // Recover ONLY the observed boolean-false case; unknown response shapes fail closed.
  if (Object.values(sources).some(source => typeof source !== 'string' && source !== false)) {
    fail('Неизвестный тип содержимого модуля.');
  }
  if (!revision(response.revision)) fail('Нет корректной ревизии ответа /deploy.');
  if (typeof fetchFullState !== 'function') fail('Не задано чтение полного снимка.');
  options.notice?.('RR CLI 0.2.0: ответ содержит false вместо текста; читаем полный снимок, без повторного push.');
  let fresh;
  try { fresh = await fetchFullState(); }
  catch { fail('Не удалось прочитать полный снимок /get. Проверьте подключение и повторите штатный workflow.'); }
  if (!record(fresh) || !revision(fresh.revision) || fresh.revision !== response.revision) {
    fail('Серверная ревизия изменилась или не подтверждена. Не продолжайте миграцию при конкурентной публикации.');
  }
  if (!stringMap(fresh.canonical_modules)) fail('Полный снимок тоже не содержит текст всех модулей.');
  // Code pushes supply the complete module manifest. Preserve all of it, including
  // remote-only modules that the CLI already keeps during a targeted push.
  if (options.expectedManifest !== undefined) {
    const manifest = options.expectedManifest;
    if (!Array.isArray(manifest) || manifest.some(name => typeof name !== 'string') || new Set(manifest).size !== manifest.length) {
      fail('Неправильный manifest текущего push.');
    }
    const expected = [...manifest].sort();
    const actual = Object.keys(fresh.canonical_modules).sort();
    if (JSON.stringify(expected) !== JSON.stringify(actual)) fail('Полный снимок не совпадает с manifest текущего push.');
  } else {
    // A static-only push has no code manifest. At minimum, preserve every named
    // module in the response; an incomplete full state is not accepted.
    for (const name of Object.keys(sources)) {
      if (!Object.hasOwn(fresh.canonical_modules, name)) fail('В полном снимке отсутствует модуль из ответа /deploy.');
    }
  }
  // Keep original revision, static and db_changes; only repair the source map.
  return { ...response, canonical_modules: { ...fresh.canonical_modules } };
}
