import {db,api,InputFile,EndpointError} from 'sdk';
import {sql} from 'sdk/db';
import {bindSQL} from './sdk-bind.js';
import {ADMIN_IDS,DEPLOY_ENV,EXPECTED_BOT_USERNAME} from './config.js';
import {GAMES,SEED} from './generated.js';
import checkAccess from '../../endpoints/checkAccess.js';
import {repository as legacy} from './legacy-store.js';
import {createRecordStore,catalogRepository} from './record-store.js';
import {createService} from './service.js';
import {createContestService} from './contest-service.js';
import {createBackupService} from './backup-service.js';
import {createInitialState,DomainError} from './domain.js';
// SDK read methods choose the read-only mode; run is reserved for mutations.
export const raw={run:(text,params={})=>db.run(text,params),get:(text,params={})=>db.get(bindSQL(text,params,sql)),all:(text,params={})=>db.all(bindSQL(text,params,sql))};
export async function getPackage1({initialize=true}={}){
 const bot=await api.getMe({});
 if(EXPECTED_BOT_USERNAME&&bot.username?.toLowerCase()!==EXPECTED_BOT_USERNAME.toLowerCase())throw new EndpointError('Ключ относится к другому боту. Публикация остановлена.',{code:'WRONG_BOT'});
 const store=createRecordStore(raw,{environment:DEPLOY_ENV,botId:bot.id});
 const table=await raw.get("SELECT name FROM sqlite_master WHERE type='table' AND name='rr_records'",{});
 if(!table){if(!initialize)return {bot,legacy,store:null};throw new EndpointError('Требуется миграция схемы.',{code:'MIGRATION_REQUIRED'});}
 const repository=catalogRepository(store,legacy);
 if(initialize){let old=await repository.read();if(!old)old=await repository.initialize(createInitialState(SEED,GAMES,new Date().toISOString()));}
 const h=await store.head();if(h?.meta?.botId&&h.meta.botId!==bot.id)throw new EndpointError('Идентификатор среды не совпадает.',{code:'WRONG_BOT'});
 const catalog=createService({repository,adminIds:ADMIN_IDS,games:GAMES,seed:SEED,checkSubscription:ctx=>checkAccess({},ctx)});
 const contest=createContestService({store,adminIds:ADMIN_IDS,checkSubscription:ctx=>checkAccess({},ctx),getBotUsername:async()=>bot.username});
 const sendDocument=(uid,name,bytes,caption)=>api.sendDocument({chat_id:uid,document:new InputFile(bytes,name,{type:'application/json'}),caption,disable_content_type_detection:true});
 const backup=createBackupService({store,adminIds:ADMIN_IDS,availableGames:GAMES,sendDocument});
 return {bot,store,repository,catalog,contest,backup};
}
export async function boundary(fn){try{return await fn();}catch(e){if(e?.name==='DomainError'){throw new EndpointError(e.message,{code:e.code,...(e.joinUrl?{joinUrl:e.joinUrl}:{})});}console.error('RedRooms internal failure:',e?.name||'Error');throw e;}}
