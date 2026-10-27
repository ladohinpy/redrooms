/** Privileged CLI uses the same verified-admin guard; never exposes backup to players. */
import {api,InputFile,db,EndpointError} from 'sdk';
import {ADMIN_IDS,DEPLOY_ENV,EXPECTED_BOT_USERNAME} from '../lib/rr/config.js';
import {verifiedUser} from '../lib/rr/service.js';
import {packBackup,backupFileName,MAX_BACKUP_BYTES} from '../lib/rr/backup.js';
import {utf8} from '../lib/rr/digest.js';
import {probeStorage} from '../lib/rr/sdk-probe.js';
import {getPackage1,boundary,raw} from '../lib/rr/package1-runtime.js';
export default async function(input,ctx){return boundary(async()=>{
 const uid=verifiedUser(ctx);if(!ADMIN_IDS.includes(uid))throw new EndpointError('Доступ только администраторам.',{code:'FORBIDDEN'});
 const bot=await api.getMe({});
 if(EXPECTED_BOT_USERNAME&&bot.username?.toLowerCase()!==EXPECTED_BOT_USERNAME.toLowerCase())throw new EndpointError('Ключ относится к другому боту.',{code:'WRONG_BOT'});
 if(!EXPECTED_BOT_USERNAME)throw new EndpointError('Укажите ожидаемый username бота для этой среды.',{code:'TARGET_REQUIRED'});
 if(input.action==='info')return {ok:true,botId:bot.id,botUsername:bot.username,environment:DEPLOY_ENV};
 if(input.action==='probe')return probeStorage(raw);
 if(input.action!=='backup')throw new EndpointError('Неизвестное действие.',{code:'BAD_REQUEST'});
 const p=await getPackage1({initialize:false});
 if(p.store&&await p.store.head()){
  const result=await p.backup.sendSnapshot(await p.backup.snapshot(),input.scheduled?'Плановый бэкап':'Перед обновлением');
  if(!result.complete)throw new EndpointError('Копия доставлена не обоим администраторам. Обновление остановлено. Откройте личный чат с ботом и разрешите сообщения.',{code:'BACKUP_DELIVERY'});
  return {...result,ok:true};
 }
 const legacyTable=await raw.get("SELECT name FROM sqlite_master WHERE type='table' AND name='rr_admin_state'",{});
 const old=legacyTable?await p.legacy.read():null;
 if(!old)return {ok:true,empty:true,message:'Накопленной базы ещё нет; пропуск копии только для первого запуска.'};
 const head={revision:old.revision},b=packBackup([{key:'admin',kind:'admin',data:old.state}],head,{at:new Date().toISOString(),environment:DEPLOY_ENV,botId:bot.id});
 const bytes=utf8(JSON.stringify(b));if(bytes.length>MAX_BACKUP_BYTES)throw new EndpointError('Копия превышает лимит.',{code:'TOO_LARGE'});
 const sent=[],failed=[];
 for(const id of ADMIN_IDS){try{await api.sendDocument({chat_id:id,document:new InputFile(bytes,backupFileName(b),{type:'application/json'}),caption:`Бэкап RedRooms от ${b.createdAt}\nПеред первым конкурсным обновлением. Среда: ${DEPLOY_ENV}. ${bytes.length} байт.\nJSON для восстановления. Храните файл приватно, не в публичном репозитории.`,disable_content_type_detection:true});sent.push(id);}catch(_){failed.push(id);}}
 if(failed.length)throw new EndpointError('Не удалось отправить копию обоим администраторам. Откройте чат с ботом и нажмите «Начать», затем повторите выпуск.',{code:'BACKUP_DELIVERY'});
 return {ok:true,fileName:backupFileName(b),bytes:bytes.length,checksum:b.checksum,sent};
});}
