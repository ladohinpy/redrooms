import {fail,clone,object,normalizeCatalog,playableCatalog,gameBuild} from './domain.js';
import {digest,utf8,canonical} from './digest.js';
import {normalizeContent} from './content.js';
export const BACKUP_FORMAT='redrooms-backup';
export const MAX_BACKUP_BYTES=40*1024*1024;
const kinds=new Set(['admin','content','contest','player','attempt','reservation','request','moderation','final','finalNote','visit','template']);
export function packBackup(records,head,{at=new Date().toISOString(),environment='stage',botId=null}={}){
 const core={format:BACKUP_FORMAT,version:1,createdAt:at,source:{environment,botId,revision:head.revision},records:records.map(({key,kind,data})=>({key,kind,data:clone(data)})).sort((a,b)=>a.key.localeCompare(b.key))};
 return {...core,checksum:digest(core)};
}
export function validateAdminState(s,availableGames){
 object(s,'Каталоги');if(s.schemaVersion!==1||!Array.isArray(s.catalog_versions)||!Array.isArray(s.game_releases)||!Array.isArray(s.game_versions))fail('Неизвестная структура исходной базы.');
 const ids=new Set();for(const c of s.catalog_versions){if(ids.has(c.id))fail('Дубли версий каталога.');ids.add(c.id);normalizeCatalog(c.catalog);if(c.status==='published'&&digest(playableCatalog(c.catalog))!==digest(c.playable))fail('Ответы опубликованного каталога не совпадают.');}
 const releases=new Set();for(const r of s.game_releases){if(releases.has(r.id)||!ids.has(r.catalogVersionId))fail('Нарушены ссылки релизов.');releases.add(r.id);const g=s.game_versions.find(g=>g.id===r.gameVersionId);if(!g||g.codeHash!==r.codeHash)fail('Нарушена связь релиза со сборкой.');}
 for(const g of s.game_versions){gameBuild(g);if(availableGames&&!availableGames.some(x=>x.id===g.id&&x.codeHash===g.codeHash&&x.entry===g.entry))fail('В этом деплое нет игровой сборки '+g.id+'. Сначала восстановите её файлы.','BUILD_UNAVAILABLE');}
 if(!releases.has(s.app_settings?.defaultReleaseId)||!Array.isArray(s.app_settings?.gameDefaults))fail('Не найден основной набор.');
 for(const p of s.app_settings.gameDefaults)if(!releases.has(p.releaseId))fail('Не найден релиз настройки game.');
 return true;
}
export function parseBackup(input,{availableGames,currentRecords=[],allowLegacy=true}={}){
 let b=typeof input==='string'?JSON.parse(input):clone(input);object(b,'Резервная копия');
 if(utf8(JSON.stringify(b)).length>MAX_BACKUP_BYTES)fail('Размер копии превышает 40 МиБ.','TOO_LARGE');
 let legacy=false;
 if(b.format!==BACKUP_FORMAT){const s=b.state||b;if(!allowLegacy||s.schemaVersion!==1||!s.catalog_versions)fail('Это не резервная копия RedRooms.');validateAdminState(s,availableGames);b=packBackup([{key:'admin',kind:'admin',data:s}],{revision:b.revision||0},{at:typeof b.createdAt==='string'&&Number.isFinite(Date.parse(b.createdAt))?b.createdAt:null,environment:'legacy'});legacy=true;}
 if(b.version!==1||!Array.isArray(b.records)||typeof b.checksum!=='string')fail('Неизвестная версия резервной копии.');const {checksum,...core}=b;if(digest(core)!==checksum)fail('Контрольная сумма не совпадает. Файл повреждён или изменён.','BACKUP_CHECKSUM');
 if(!b.source||!Number.isSafeInteger(b.source.revision)||b.source.revision<0||!['stage','production','legacy'].includes(b.source.environment)||(b.createdAt!==null&&!Number.isFinite(Date.parse(b.createdAt))))fail('Некорректные метаданные копии.');
 const byKey=new Map();for(const r of b.records){if(!r||typeof r.key!=='string'||r.key.length>240||r.key==='@head'||byKey.has(r.key)||!kinds.has(r.kind))fail('Некорректная или повторная запись копии.');object(r.data,'Запись '+r.key);byKey.set(r.key,r);}
 const s=byKey.get('admin')?.data;if(!s)fail('В копии отсутствуют наборы.');validateAdminState(s,availableGames);
 const releases=new Set(s.game_releases.map(x=>x.id)),cats=new Set(s.catalog_versions.map(x=>x.id));
 for(const r of b.records){const x=r.data;
  if(r.kind==='content'){normalizeContent(x);if(!cats.has(x.catalogId)||r.key!=='content:'+x.catalogId)fail('Материал ссылается на неизвестный набор.');}
  if(r.kind==='admin'&&r.key!=='admin')fail('Неизвестная запись редакторской базы.');
  if(r.kind==='player'&&(!Number.isSafeInteger(x.userId)||x.userId<=0||r.key!=='player:'+x.userId))fail('Неверный Telegram ID в копии.');
  if(r.kind==='contest'){if(!releases.has(x.releaseId)||r.key!=='contest:'+x.releaseId||!cats.has(x.catalogVersionId))fail('Нарушены связи конкурса.');const c=s.catalog_versions.find(c=>c.id===x.catalogVersionId);if(digest(c.playable)!==x.catalogDigest||s.game_releases.find(r=>r.id===x.releaseId)?.catalogVersionId!==x.catalogVersionId)fail('Версия конкурсного набора отличается.');if(!['planned','active','review','archive'].includes(x.status)||x.rules?.version!==1||x.rules.maxAttempts!==2)fail('Неизвестные правила конкурса.');}
  if(r.kind==='attempt'){if(!['contest','preview','archive','practice'].includes(x.mode)||!['started','unfinished','completed'].includes(x.status)||typeof x.voided!=='boolean'||typeof x.eligible!=='boolean'||!Number.isFinite(Date.parse(x.startedAt))||(x.mode==='contest'?![1,2].includes(x.slot):x.slot!==null))fail('Неверный формат попытки.');if(x.status==='completed'&&(!Number.isFinite(Date.parse(x.finishedAt))||!x.calculated||!Number.isInteger(x.calculated.score)||!Number.isFinite(x.calculated.accuracy)||!Array.isArray(x.raw?.actions)||!Array.isArray(x.raw?.answers)))fail('Завершённый результат повреждён.');if(!releases.has(x.releaseId)||!byKey.has('player:'+x.userId)||r.key!=='attempt:'+x.id||!cats.has(x.catalogVersionId))fail('Нарушены связи попытки.');if(x.mode==='contest'&&!byKey.has('contest:'+x.releaseId))fail('Нет конкурса для попытки.');}
  if(r.kind==='reservation'){if(r.key!==`reservation:${x.releaseId}:${x.userId}`||!byKey.has('player:'+x.userId)||!releases.has(x.releaseId)||!Array.isArray(x.slots))fail('Неверный лимит попыток.');const used=x.slots.filter(a=>!a.voided);if(used.some(a=>![1,2].includes(a.slot))||new Set(used.map(a=>a.slot)).size!==used.length)fail('Нарушен лимит двух попыток.');for(const a of x.slots){const t=byKey.get('attempt:'+a.attemptId)?.data;if(!t||t.userId!==x.userId||t.releaseId!==x.releaseId||t.mode!=='contest'||t.slot!==a.slot||t.voided!==a.voided)fail('Резервация ссылается на несогласованную попытку.');}if(x.activeId){const a=byKey.get('attempt:'+x.activeId)?.data;if(!a||a.userId!==x.userId||a.releaseId!==x.releaseId||a.status!=='started'||a.voided)fail('Нет активной попытки.');}}
  if(r.kind==='request'){const a=byKey.get('attempt:'+x.attemptId)?.data;if(!a||a.releaseId!==x.releaseId||!r.key.startsWith('start:'+a.userId+':'))fail('Повреждена идемпотентность попытки.');}
  if(r.kind==='template'&&!cats.has(r.key.replace(/^contestTemplate:/,'')))fail('Не найден шаблон настроек.');
  if(r.kind==='final'){if(r.key!=='final:'+x.releaseId||!byKey.has('contest:'+x.releaseId)||!Array.isArray(x.rankings))fail('Неверные опубликованные итоги.');for(const p of x.rankings)if(!byKey.has('player:'+p.userId)||!byKey.has('attempt:'+p.attemptId))fail('Итоги ссылаются на отсутствующие данные.');}
 }
 // Restore may not silently erase/rewrite official historical results.
 for(const r of currentRecords.filter(r=>r.kind==='final'))if(digest(byKey.get(r.key)?.data||null)!==digest(r.data))fail('Копия удаляет или меняет уже опубликованные итоги '+r.data.releaseId+'. Восстановление остановлено.','PUBLISHED_HISTORY');
 const counts={};for(const r of b.records)counts[r.kind]=(counts[r.kind]||0)+1;
 return {backup:b,legacy,counts,bytes:utf8(JSON.stringify(b)).length};
}
export function backupFileName(b){return `RedRooms-${b.source.environment}-${b.createdAt.replace(/[:.]/g,'-')}.json`;}
