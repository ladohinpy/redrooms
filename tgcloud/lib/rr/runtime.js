import { setLink } from './simple.js';
import { api, EndpointError } from 'sdk';
import checkAccess from '../../endpoints/checkAccess.js';
import { getPackage1 } from './package1-runtime.js';
import { repository } from './store.js';
import { ADMIN_IDS } from './config.js';
import { GAMES, SEED } from './generated.js';
// The existing API now reads the migrated, versioned catalog repository.
export async function invoke(method, input, ctx) {
  try {
    const package1=await getPackage1(); const service=package1.catalog;
    if(method==='launch'&&input?.previewCatalogId){
      const status=await service.status({},ctx);
      if(status.isAdmin!==true)throw new EndpointError('Набор недоступен.',{code:'NOT_FOUND'});
      const preview=await package1.contest.preview({catalogId:input.previewCatalogId},ctx);
      const game=GAMES.find(g=>g.id==='v10-clean-start'&&g.contestEngine) || GAMES.find(g=>g.id==='v09-contests'&&g.contestEngine);
      if(!game)throw new EndpointError('Нужна обновлённая сборка игры.',{code:'NOT_READY'});
      return {game,runtime:game,catalog:preview.catalog,previewCatalogId:preview.previewCatalogId,previewLobby:preview,userId:status.userId,isAdmin:true,release:{id:preview.releaseId,name:preview.name,catalogVersionId:preview.catalogVersionId}};
    }
    // Detailed and simple editors use the same complete clone operation.
    if(method==='command'&&input?.action==='cloneCatalog'){
      const original=await service.read({},ctx);
      if(original.revision!==input.expectedRevision)throw new EndpointError('Данные изменились. Обновите редактор.',{code:'CONFLICT'});
      await package1.contest.adminCommand({command:'cloneSet',sourceId:input.input?.sourceId,id:input.input?.id,name:input.input?.name,expectedRevision:(await package1.store.head()).revision},ctx);
      return service.read({},ctx);
    }
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
      return { ok: true, revision: result.revision, defaultReleaseId: result.state.app_settings.defaultReleaseId, catalogs: result.state.catalog_versions.length, games: GAMES.length, storageVersion:1, storageRevision:(await package1.store.head()).revision, environment:package1.store.environment, botUsername:package1.bot.username };
    }
    let result;
    try {result=await service[method](input,ctx);}
    catch(error){if(method==='launch'&&error?.code==='SUBSCRIPTION_REQUIRED')try{await package1.contest.observe(ctx,{allowed:false});}catch(_){}throw error;}
    if(method==='launch'&&!result.admin)try{await package1.contest.observe(ctx,{allowed:true,releaseId:result.release?.id});}catch(_){}

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
