import {fail} from './domain.js';
import {verifiedUser} from './service.js';
import {packBackup,parseBackup,backupFileName,MAX_BACKUP_BYTES} from './backup.js';
import {utf8,digest} from './digest.js';
export const BACKUP_CHUNK_CHARS=100000;
export function createBackupService({store,adminIds,availableGames,sendDocument,now=()=>new Date().toISOString(),newId=()=>Date.now().toString(36)+'-'+Math.random().toString(36).slice(2)}){
 const admin=ctx=>{const uid=verifiedUser(ctx);if(!adminIds.includes(uid))fail('Доступ только администраторам.','FORBIDDEN');return uid;};
 const metadata=async(token,uid)=>{const m=await store.readTransfer(token,'meta');if(!m||m.owner!==uid||Date.parse(m.expiresAt)<Date.parse(now()))fail('Передача не найдена или истекла. Загрузите файл снова.','NOT_FOUND');return m;};
 async function snapshot(){const h=await store.head();if(!h)fail('База пока не инициализирована.');const records=await store.view(h).list();return packBackup(records,h,{at:now(),environment:store.environment,botId:store.botId});}
 async function send(b,tag='Резервная копия'){
  const text=JSON.stringify(b),bytes=utf8(text);if(bytes.length>MAX_BACKUP_BYTES)fail('Бэкап превышает лимит приложения 40 МиБ. Данные не менялись.','TOO_LARGE');
  const name=backupFileName(b),sent=[],failed=[];
  for(const uid of adminIds){try{await sendDocument(uid,name,bytes,`${tag} RedRooms от ${b.createdAt}\nСреда: ${store.environment}. JSON для восстановления, не для импорта набора.\nЗаписей: ${b.records.length}; размер: ${bytes.length} байт.\nХраните приватно: внутри Telegram ID и история прохождений.`);sent.push(uid);}catch(_){failed.push(uid);}}
  return {fileName:name,bytes:bytes.length,checksum:b.checksum,createdAt:b.createdAt,sent,failed,complete:failed.length===0};
 }
 async function assemble(token,uid){const m=await metadata(token,uid);let text='';for(let i=0;i<m.parts;i++){const p=await store.readTransfer(token,'part-'+i);if(typeof p?.text!=='string')fail(`Не загружен фрагмент ${i+1}.`);text+=p.text;}if(utf8(text).length>MAX_BACKUP_BYTES)fail('Файл больше 40 МиБ.');return {text,meta:m};}
 return {
  async export(input,ctx){admin(ctx);return snapshot();},
  async send(input,ctx){admin(ctx);return send(await snapshot());},
  async prepareExport(input,ctx){const uid=admin(ctx),b=await snapshot(),text=JSON.stringify(b),bytes=utf8(text).length;if(bytes>MAX_BACKUP_BYTES)fail('Копия больше 40 МиБ.','TOO_LARGE');const token='export-'+newId(),parts=Math.ceil(text.length/BACKUP_CHUNK_CHARS);await store.putTransfer(token,'meta','transfer',{owner:uid,purpose:'export',parts,expiresAt:new Date(Date.parse(now())+7200000).toISOString()});for(let i=0;i<parts;i++)await store.putTransfer(token,'part-'+i,'transferPart',{text:text.slice(i*BACKUP_CHUNK_CHARS,(i+1)*BACKUP_CHUNK_CHARS)});return {token,parts,bytes,fileName:backupFileName(b),checksum:b.checksum};},
  async exportPart(input,ctx){const uid=admin(ctx),m=await metadata(input.token,uid);if(m.purpose!=='export'||!Number.isInteger(input.part)||input.part<0||input.part>=m.parts)fail('Неверный фрагмент.');return store.readTransfer(input.token,'part-'+input.part);},
  async uploadBegin(input,ctx){const uid=admin(ctx);if(!Number.isInteger(input.parts)||input.parts<1||input.parts>500||!Number.isInteger(input.bytes)||input.bytes<1||input.bytes>MAX_BACKUP_BYTES)fail('Копия должна быть JSON до 40 МиБ.');const token='upload-'+newId();await store.putTransfer(token,'meta','transfer',{owner:uid,purpose:'upload',parts:input.parts,bytes:input.bytes,expiresAt:new Date(Date.parse(now())+7200000).toISOString()});return {token};},
  async uploadPart(input,ctx){const uid=admin(ctx),m=await metadata(input.token,uid);if(m.purpose!=='upload'||!Number.isInteger(input.part)||input.part<0||input.part>=m.parts||typeof input.text!=='string'||input.text.length>BACKUP_CHUNK_CHARS)fail('Неверный фрагмент.');await store.putTransfer(input.token,'part-'+input.part,'transferPart',{text:input.text});return {saved:true};},
  async preview(input,ctx){const uid=admin(ctx),{text}=await assemble(input.token,uid),h=await store.head(),currentRecords=await store.view(h).list();let checked;try{checked=parseBackup(text,{availableGames,currentRecords});}catch(e){if(e instanceof SyntaxError)fail('Файл не является корректным JSON.');throw e;}return {token:input.token,expectedRevision:h.revision,counts:checked.counts,bytes:checked.bytes,legacy:checked.legacy,createdAt:checked.backup.createdAt,source:checked.backup.source,crossEnvironment:checked.backup.source.botId!==store.botId,checksum:checked.backup.checksum,confirmation:`RESTORE ${store.environment} ${store.botId??'unknown'} ${checked.backup.checksum.slice(0,12)}`};},
  async restore(input,ctx){const uid=admin(ctx),{text}=await assemble(input.token,uid),h=await store.head();if(h.revision!==input.expectedRevision)fail('База изменилась после предпросмотра. Выполните проверку снова.','CONFLICT');const currentRecords=await store.view(h).list(),checked=parseBackup(text,{availableGames,currentRecords});const expected=`RESTORE ${store.environment} ${store.botId??'unknown'} ${checked.backup.checksum.slice(0,12)}`;if(input.confirm!==expected)fail('Для восстановления введите точное подтверждение.');if(checked.backup.source.botId!==store.botId&&input.allowCrossEnvironment!==true)fail('Это копия другой среды. Требуется отдельное подтверждение.');
   const before=packBackup(currentRecords,h,{at:now(),environment:store.environment,botId:store.botId}),receipt=await send(before,'Перед восстановлением');if(!receipt.complete)fail('Не удалось отправить страховочную копию обоим администраторам. Восстановление не выполнялось.','BACKUP_DELIVERY');
   const restoreId='restore-log:'+newId(),restoreLog={key:restoreId,kind:'moderation',data:{id:restoreId,at:now(),actor:uid,action:'restoreDatabase',target:'database',before:{revision:h.revision,checksum:receipt.checksum},after:{checksum:checked.backup.checksum,source:checked.backup.source},reason:'Восстановление после явного подтверждения администратора'}};
   const restoreRecords=[...checked.backup.records,restoreLog],gen=await store.stageRestore(restoreRecords),staged=await store.view({generation:gen,revision:0}).list();
   if(digest(staged.map(({key,kind,data})=>({key,kind,data})).sort((a,b)=>a.key.localeCompare(b.key)))!==digest(restoreRecords.slice().sort((a,b)=>a.key.localeCompare(b.key))))fail('Не совпала проверка загруженных данных. Рабочая база не изменена.','BACKUP_CHECKSUM');
   const next=await store.publishRestore(h,gen,{restoredAt:now(),restoredBy:uid,restoredFrom:checked.backup.checksum,preRestoreBackup:receipt.checksum});return {restored:true,revision:next.revision,counts:checked.counts,preRestoreBackup:receipt};
  },
  snapshot,sendSnapshot:send
 };
}
