import { api, EndpointError } from 'sdk';
import checkAccess from '../../endpoints/checkAccess.js';
import { createService } from './service.js';
import { repository } from './store.js';
import { ADMIN_IDS } from './config.js';
import { GAMES, SEED } from './generated.js';
const service = createService({ repository, adminIds: ADMIN_IDS, games: GAMES, seed: SEED, checkSubscription: ctx => checkAccess({}, ctx) });
export async function invoke(method, input, ctx) {
  try {
    if (method === 'health') {
      const result = await service.read({}, ctx);
      return { ok: true, revision: result.revision, defaultReleaseId: result.state.app_settings.defaultReleaseId, catalogs: result.state.catalog_versions.length, games: GAMES.length };
    }
    const result = await service[method](input, ctx);
    if (method === 'status' && result.isAdmin) {
      try { const bot = await api.getMe({}); if (/^[a-zA-Z0-9_]{5,32}$/.test(bot?.username || '')) result.botUsername = bot.username; }
      catch (_) { /* Management still works; share a web URL instead. */ }
    }
    return result;
  } catch (error) {
    if (error?.name === 'DomainError') {
      const parameters = { code: error.code };
      if (error.joinUrl) parameters.joinUrl = error.joinUrl;
      throw new EndpointError(error.message, parameters);
    }
    throw error; // SDK returns a generic internal error; do not leak internals.
  }
}
