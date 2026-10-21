import { setLink } from './simple.js';
import { api, EndpointError } from 'sdk';
import checkAccess from '../../endpoints/checkAccess.js';
import { createService } from './service.js';
import { repository } from './store.js';
import { ADMIN_IDS } from './config.js';
import { GAMES, SEED } from './generated.js';
const service = createService({ repository, adminIds: ADMIN_IDS, games: GAMES, seed: SEED, checkSubscription: ctx => checkAccess({}, ctx) });
export async function invoke(method, input, ctx) {
  try {
    if (method === 'sendLink') {
      // Authenticate BEFORE looking up a release. Recipient is never taken from input.
      const result=await service.read({},ctx);
      const r=result.state.game_releases.find(r=>r.id===input?.releaseId && r.status==='published');
      if(!r)throw new EndpointError('Опубликованный набор не найден.',{code:'NOT_FOUND'});
      const bot=await api.getMe({});
      const url=setLink(bot.username,r.id);
      try { await api.sendMessage({chat_id:ctx.initData.user.id,text:`${r.name}\n\n${url}`,disable_web_page_preview:true}); }
      catch (_) {throw new EndpointError('Не удалось отправить сообщение в ваш чат с ботом.',{code:'BOT_MESSAGE_UNAVAILABLE'});}
      return {sent:true};
    }
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
