import { DomainError, fail, object, byteLength, LIMITS, createInitialState, applyCommand, parseSelector, resolveLaunch } from './domain.mjs';
import {verifiedUser,createAdminPolicy} from './admin-access.mjs';
export {verifiedUser} from './admin-access.mjs';
export function createService({ repository, adminIds, games, seed, checkSubscription, now = () => new Date().toISOString() }) {
  const policy=createAdminPolicy(adminIds),isAdmin=policy.isAdmin,admin=policy.requireAdmin;
  async function state() {
    return await repository.read() || await repository.initialize(createInitialState(seed, games, now()));
  }
  return {
    async status(_input, ctx) { return policy.status(ctx); },
    async read(_input, ctx) {
      const uid=admin(ctx); const row = await state();
      return { revision: row.revision, state: row.state, availableGames: games, limits: LIMITS, access:{userId:uid,isAdmin:true} };
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
      const contestRuntime=games.find(g=>g.id==='v09-contests'&&g.contestEngine===true);
      // Existing logical release IDs/save namespaces stay intact. A new immutable renderer
      // adds the server attempt protocol; no published game artifact is rewritten.
      const cleanRuntime=games.find(g=>g.id==='v10-clean-start'&&g.contestEngine===true);
      const cleanSources={
        'v06':'05ac2cca6a93c5b2701898f807c2c2d3e4a840216aec975e28d003ff09427749',
        'v07-tables':'4c7b0fb7cf2d4da84737bd3673b8c2caa5edc293883d46b46fa6abca42281530',
        'v08-player-ui':'e646963e07411913b92698b7ca200ea86ec2832cd0aafa4fb127be59a4f24d84',
        'v09-contests':'69026d9e0f0512e3d86565e5026e967db36814734485a002ef129be802c6f4d1'
      };
      const compatibleRuntime=cleanRuntime && cleanSources[selected.game.id]===selected.game.codeHash
        ? cleanRuntime : contestRuntime && ['v06','v07-tables','v08-player-ui','v09-contests'].includes(selected.game.id)
        ? contestRuntime : repairable ? (publicRuntime || previousRepair) : null;
      const entryFix=games.find(g=>g.id==='v11-access-entry'&&g.contestEngine===true);
      const entrySources={"v06":"05ac2cca6a93c5b2701898f807c2c2d3e4a840216aec975e28d003ff09427749","v07-tables":"4c7b0fb7cf2d4da84737bd3673b8c2caa5edc293883d46b46fa6abca42281530","v08-player-ui":"e646963e07411913b92698b7ca200ea86ec2832cd0aafa4fb127be59a4f24d84","v09-contests":"69026d9e0f0512e3d86565e5026e967db36814734485a002ef129be802c6f4d1","v10-clean-start":"9fe3373af2f0d407b86760748604ca373f82195e262dfebc0a1d3dfd92cc8337"};
      const attemptFix=games.find(g=>g.id==='v12-attempt-state'&&g.contestEngine===true);
      const attemptSources={"v06":"05ac2cca6a93c5b2701898f807c2c2d3e4a840216aec975e28d003ff09427749","v07-tables":"4c7b0fb7cf2d4da84737bd3673b8c2caa5edc293883d46b46fa6abca42281530","v08-player-ui":"e646963e07411913b92698b7ca200ea86ec2832cd0aafa4fb127be59a4f24d84","v09-contests":"69026d9e0f0512e3d86565e5026e967db36814734485a002ef129be802c6f4d1","v10-clean-start":"9fe3373af2f0d407b86760748604ca373f82195e262dfebc0a1d3dfd92cc8337","v11-access-entry":"6e136d185b8ef78f7db42d9f3c7c3adc155b97f71f4aece21c8d363274e22942"};
      const runtime=attemptFix&&attemptSources[selected.game.id]===selected.game.codeHash ? attemptFix : entryFix&&entrySources[selected.game.id]===selected.game.codeHash ? entryFix : compatibleRuntime||selected.game;
      return { ...selected, runtime, userId: uid, isAdmin: isAdmin(uid) };
    }
  };
}
