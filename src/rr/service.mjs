import { DomainError, fail, object, byteLength, LIMITS, createInitialState, applyCommand, parseSelector, resolveLaunch } from './domain.mjs';
export function verifiedUser(ctx) {
  const uid = ctx?.initData?.user?.id;
  if (!Number.isSafeInteger(uid) || uid <= 0) fail('Откройте приложение через Telegram.', 'AUTH_REQUIRED');
  return uid;
}
export function createService({ repository, adminIds, games, seed, checkSubscription, now = () => new Date().toISOString() }) {
  const isAdmin = uid => adminIds.includes(uid);
  const admin = ctx => { const uid = verifiedUser(ctx); if (!isAdmin(uid)) fail('Доступ только администраторам.', 'FORBIDDEN'); return uid; };
  async function state() {
    return await repository.read() || await repository.initialize(createInitialState(seed, games, now()));
  }
  return {
    async status(_input, ctx) { const uid = verifiedUser(ctx); return { userId: uid, isAdmin: isAdmin(uid), configured: adminIds.length === 2 }; },
    async read(_input, ctx) {
      admin(ctx); const row = await state();
      return { revision: row.revision, state: row.state, availableGames: games, limits: LIMITS };
    },
    async command(input, ctx) {
      const uid = admin(ctx); object(input, 'Запрос');
      if (byteLength(JSON.stringify(input)) > LIMITS.fileBytes + 16384) fail('Слишком большой запрос.', 'TOO_LARGE');
      if (!Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 1) fail('Нет версии для безопасного сохранения.', 'CONFLICT');
      const row = await state();
      if (row.revision !== input.expectedRevision) fail('Другой администратор уже сохранил изменения. Скачайте свои несохранённые данные и обновите экран.', 'CONFLICT');
      const next = applyCommand(row.state, input, uid, games, now());
      const saved = await repository.compareSwap(row.revision, next);
      if (!saved) fail('Данные изменились во время сохранения. Перезагрузите данные и сравните правки.', 'CONFLICT');
      return { revision: saved.revision, state: saved.state, availableGames: games, limits: LIMITS };
    },
    async launch(input, ctx) {
      const uid = verifiedUser(ctx); object(input || {}, 'Параметры');
      // The launch parameter is an instruction, never proof of administrator rights.
      let selector = parseSelector({ release: input?.release, game: input?.game, startParam: input?.default === true ? undefined : ctx?.initData?.start_param });
      if (selector.kind === 'admin') {
        if (isAdmin(uid)) return { admin: true, userId: uid, isAdmin: true };
        // Non-admin startapp=admin has the same access checks and UI as an ordinary launch.
        selector = parseSelector({});
      }
      const access = await checkSubscription(ctx);
      if (access?.allowed !== true) {
        const e = new DomainError('Для входа подпишитесь на канал и нажмите «Проверить снова».', 'SUBSCRIPTION_REQUIRED');
        if (typeof access?.joinUrl === 'string' && /^https:\/\/t\.me\/[a-zA-Z0-9_+\-]+$/.test(access.joinUrl)) e.joinUrl = access.joinUrl;
        throw e;
      }
      const row = await state();
      const selected = resolveLaunch(row.state, selector, isAdmin(uid), games);
      // Public-UI hotfix: use the new renderer only for the exact two known shipped builds.
      // Preserve stored releases, catalog bindings, selected default, logical game and save keys.
      const repairable =
        (selected.game.id === 'v06' && selected.game.codeHash === '05ac2cca6a93c5b2701898f807c2c2d3e4a840216aec975e28d003ff09427749') ||
        (selected.game.id === 'v07-tables' && selected.game.codeHash === '4c7b0fb7cf2d4da84737bd3673b8c2caa5edc293883d46b46fa6abca42281530');
      const publicRuntime = games.find(g => g.id === 'v08-player-ui' && g.optionalYear === true);
      const previousRepair = selected.game.id === 'v06'
        ? games.find(g => g.id === 'v07-tables' && g.optionalYear === true) : null;
      const compatibleRuntime = repairable ? (publicRuntime || previousRepair) : null;
      return { ...selected, runtime: compatibleRuntime || selected.game, userId: uid, isAdmin: isAdmin(uid) };
    }
  };
}
