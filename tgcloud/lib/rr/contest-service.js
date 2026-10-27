import {fail,clone,object,id,createInitialState,playableCatalog} from './domain.js';
import {verifiedUser,createAdminPolicy} from './admin-access.js';
import {normalizeContent,publicContent} from './content.js';
import {RULES,requestId,phase,endTime,profile,calculateAttempt,leaderboard,summarize,publicAttempt,publicRanking,immutableFinal} from './contest-domain.js';
import {digest} from './digest.js';
const val=async(v,key)=>(await v.get(key))?.data;
const rec=(key,kind,data)=>({key,kind,data});
const data=rows=>rows.map(r=>r.data);
const stamp=()=>new Date().toISOString();
const uuid=()=>Date.now().toString(36)+'-'+Math.random().toString(36).slice(2)+Math.random().toString(36).slice(2);
export function createContestService({store,adminIds,checkSubscription,getBotUsername=async()=>'',now=stamp,newId=uuid}){
 const policy=createAdminPolicy(adminIds),admin=policy.requireAdmin;
 const auth=async ctx=>{const uid=verifiedUser(ctx);const access=await checkSubscription(ctx);if(access?.allowed!==true)fail('Для игры нужна подписка на канал.','SUBSCRIPTION_REQUIRED');return uid;};
 async function release(v,rid,privileged){const s=await val(v,'admin');const r=s?.game_releases.find(r=>r.id===rid);if(!r||r.status==='archived'||(!privileged&&r.status!=='published'))fail('Набор недоступен.','NOT_FOUND');const c=s.catalog_versions.find(c=>c.id===r.catalogVersionId);if(!c?.playable)fail('Каталог не опубликован.','NOT_READY');return {r,c,s};}
 async function bundle(v,rid){const attempts=data(await v.list('attempt')).filter(a=>a.releaseId===rid),players=data(await v.list('player')),contest=await val(v,'contest:'+rid),final=await val(v,'final:'+rid);return {attempts,players,contest,final,rankings:final?.rankings||leaderboard(attempts,players)};}
 async function userState(v,rid,uid,at,privileged){const {r,c}=await release(v,rid,privileged);const b=await bundle(v,rid);const mine=b.attempts.filter(a=>a.userId===uid);const ranked=mine.filter(a=>a.mode==='contest'&&!a.voided),active=mine.find(a=>a.status==='started'&&!a.voided);const contents=await val(v,'content:'+c.id)||normalizeContent({});
  const currentPhase=phase(b.contest,at);const exhausted=ranked.length>=2&&!ranked.some(a=>a.status==='started');
  return {releaseId:rid,name:r.name,catalogVersionId:c.id,phase:currentPhase,startsAt:b.contest?.startedAt||null,endsAt:b.contest?.endsAt||null,closedAt:b.contest?.closedAt||null,attempts:mine.map(publicAttempt),active:publicAttempt(active),remaining:Math.max(0,2-ranked.length),rankings:publicRanking(b.rankings,uid),content:publicContent(contents,{closed:['review','archive'].includes(currentPhase),exhausted,preview:false}),isAdmin:privileged,finalized:!!b.final};
 }
 const audit=(at,actor,action,target,before,after,reason='')=>rec('audit:'+newId(),'moderation',{id:newId(),at,actor,action,target,before:before??null,after:after??null,reason});
 async function playerChanges(v,ctx,at){const uid=verifiedUser(ctx),previous=await val(v,'player:'+uid);return rec('player:'+uid,'player',profile(ctx.initData.user,previous,at));}
 function reason(input){if(typeof input.reason!=='string'||!input.reason.trim()||input.reason.length>2000)fail('Укажите причину (до 2000 символов).');return input.reason.trim();}
 async function transactUser(ctx,fn){const uid=await auth(ctx),at=now();return store.transact(v=>fn(v,uid,at));}
 return {
  async preview(input,ctx){
   const uid=admin(ctx);await auth(ctx);const v=store.view(await store.head()),s=await val(v,'admin');
   const c=s.catalog_versions.find(x=>x.id===id(input.catalogId));if(!c)fail('Набор не найден.','NOT_FOUND');
   const raw=clone(c.catalog);for(const d of raw.directors)for(const f of d.films)if(f.status==='pending')f.status='approved';
   const catalog=c.playable||playableCatalog(raw),content=publicContent(await val(v,'content:'+c.id)||normalizeContent({}),{preview:true,closed:true,exhausted:true});
   const rid='preview-'+digest(c.id).slice(0,20),state={releaseId:rid,name:c.name||raw.name,catalogVersionId:c.id,phase:'preview',attempts:[],active:null,remaining:2,rankings:[],content,isAdmin:true,finalized:false,botUsername:await getBotUsername()};
   if(input.operation==='finish'){
    const at=now(),a={id:'preview-'+requestId(input.requestId),userId:uid,releaseId:rid,catalogVersionId:c.id,mode:'preview',slot:null,status:'completed',startedAt:typeof input.startedAt==='string'&&!Number.isNaN(Date.parse(input.startedAt))?input.startedAt:at,finishedAt:at,eligible:false};
    const result=calculateAttempt(catalog,input,a,at);return {...state,saved:true,attempt:publicAttempt({...a,...result}),previewOnly:true};
   }
   return {...state,catalog,previewCatalogId:c.id};
  },
  async lobby(input,ctx){const uid=await auth(ctx);const h=await store.head();const result=await userState(store.view(h),id(input.releaseId),uid,now(),policy.isAdmin(uid));result.botUsername=await getBotUsername();return result;},
  async leaderboard(input,ctx){const uid=await auth(ctx),v=store.view(await store.head());await release(v,id(input.releaseId),policy.isAdmin(uid));const b=await bundle(v,input.releaseId);return {finalized:!!b.final,rows:publicRanking(b.rankings,uid),publishedAt:b.final?.publishedAt||null};},
  async start(input,ctx){
   const rid=id(input.releaseId),req=requestId(input.requestId),aid='a-'+newId();
   return transactUser(ctx,async(v,uid,at)=>{
    const allowed=policy.isAdmin(uid),{r,c}=await release(v,rid,allowed);
    const reqKey=`start:${uid}:${req}`,previous=await val(v,reqKey);
    if(previous){if(previous.releaseId!==rid)fail('Этот запрос уже использован для другого набора.','CONFLICT');const a=await val(v,'attempt:'+previous.attemptId);return {value:{attempt:publicAttempt(a),resumed:true}};}
    const contest=await val(v,'contest:'+rid),mode=allowed?'preview':phase(contest,at)==='active'?'contest':phase(contest,at)==='archive'||phase(contest,at)==='review'?'archive':'practice';
    const rk=`reservation:${rid}:${uid}`,reservation=await val(v,rk)||{userId:uid,releaseId:rid,slots:[],activeId:null};
    if(reservation.activeId){const a=await val(v,'attempt:'+reservation.activeId);if(a?.status==='started'&&!a.voided)return {changes:[rec(reqKey,'request',{attemptId:a.id,releaseId:rid})],value:{attempt:publicAttempt(a),resumed:true}};}
    let slot=null;
    if(mode==='contest'){const used=reservation.slots.filter(s=>!s.voided).map(s=>s.slot);slot=[1,2].find(x=>!used.includes(x));if(!slot)fail('Обе конкурсные попытки уже использованы.','ATTEMPTS_EXHAUSTED');reservation.slots.push({slot,attemptId:aid,voided:false});}
    const a={id:aid,userId:uid,releaseId:rid,catalogVersionId:c.id,catalogDigest:digest(c.playable),mode,slot,status:'started',startedAt:at,finishedAt:null,eligible:false,voided:false};
    reservation.activeId=aid;
    return {changes:[rec('attempt:'+aid,'attempt',a),rec(rk,'reservation',reservation),rec(reqKey,'request',{attemptId:aid,releaseId:rid}),await playerChanges(v,ctx,at)],value:{attempt:publicAttempt(a),resumed:false}};
   });
  },
  async finish(input,ctx,serverReceivedAt){
   const aid=id(input.attemptId,'Попытка');
   // receivedAt is captured at endpoint entry BEFORE asynchronous access checks.
   const receivedAt=serverReceivedAt||now(),uid=verifiedUser(ctx);
   const access=await checkSubscription(ctx);if(access?.allowed!==true)fail('Для игры нужна подписка на канал.','SUBSCRIPTION_REQUIRED');
   await store.transact(async v=>{
    const a=await val(v,'attempt:'+aid);if(!a||a.userId!==uid)fail('Попытка не найдена.','NOT_FOUND');
    if(a.status==='completed')return {value:true}; // Idempotent acknowledgement, even after deadline.
    if(a.status!=='started'||a.voided)fail('Эта попытка уже закрыта.','ATTEMPT_CLOSED');
    const {c}=await release(v,a.releaseId,policy.isAdmin(uid));if(digest(c.playable)!==a.catalogDigest)fail('Версия набора не совпадает.','CATALOG_CHANGED');
    const contest=await val(v,'contest:'+a.releaseId),final=await val(v,'final:'+a.releaseId);
    const calculated=calculateAttempt(c.playable,input,a,receivedAt);
    const eligible=a.mode==='contest'&&!!contest&&!final&&Date.parse(receivedAt)<endTime(contest)&&Date.parse(receivedAt)>=Date.parse(contest.startedAt);
    const next={...a,...calculated,status:'completed',finishedAt:receivedAt,eligible,late:a.mode==='contest'&&!eligible};
    const rk=`reservation:${a.releaseId}:${uid}`,reservation=await val(v,rk);if(reservation?.activeId===aid)reservation.activeId=null;
    return {changes:[rec('attempt:'+aid,'attempt',next),...(reservation?[rec(rk,'reservation',reservation)]:[]),await playerChanges(v,ctx,receivedAt)],value:true};
   });
   const v=store.view(await store.head()),a=await val(v,'attempt:'+aid),state=await userState(v,a.releaseId,uid,now(),policy.isAdmin(uid));return {saved:true,attempt:publicAttempt(a),...state};
  },
  async abandon(input,ctx){return transactUser(ctx,async(v,uid,at)=>{const a=await val(v,'attempt:'+id(input.attemptId));if(!a||a.userId!==uid)fail('Попытка не найдена.','NOT_FOUND');if(a.status!=='started')return {value:{closed:true}};const reservation=await val(v,`reservation:${a.releaseId}:${uid}`);if(reservation?.activeId===a.id)reservation.activeId=null;return {changes:[rec('attempt:'+a.id,'attempt',{...a,status:'unfinished',abandonedAt:at}),...(reservation?[rec(`reservation:${a.releaseId}:${uid}`,'reservation',reservation)]:[])],value:{closed:true}};});},
  async adminRead(input,ctx){admin(ctx);const v=store.view(await store.head());const players=data(await v.list('player')),contests=data(await v.list('contest')),contents=data(await v.list('content')),auditRows=data(await v.list('moderation')),visits=data(await v.list('visit'));const out={revision:v.head.revision,players,contests,contents,audit:auditRows.sort((a,b)=>b.at.localeCompare(a.at)).slice(0,300),visits:{sessions:visits.length,fromSetLink:visits.filter(x=>x.source==='set_link').length,observedSubscriptionTransitions:visits.filter(x=>x.firstDeniedAt&&x.firstAllowedAt).length},environment:store.environment};
   if(input.releaseId){const {r,c}=await release(v,id(input.releaseId),true),b=await bundle(v,r.id);out.release=r;out.catalogId=c.id;out.content=await val(v,'content:'+c.id)||normalizeContent({});out.contest=b.contest||null;out.final=b.final||null;out.rankings=b.rankings;out.stats=summarize(b.attempts,players);out.attempts=b.attempts.map(a=>({...a,raw:undefined}));out.finalNotes=data(await v.list('finalNote')).filter(n=>n.releaseId===r.id||n.releaseIds?.includes(r.id));}
   if(input.catalogId&&!input.releaseId){const s=await val(v,'admin');if(!s.catalog_versions.some(c=>c.id===input.catalogId))fail('Набор не найден.');out.catalogId=input.catalogId;out.content=await val(v,'content:'+input.catalogId)||normalizeContent({});}
   const allAttempts=data(await v.list('attempt'));out.players=players.map(p=>{const as=allAttempts.filter(a=>a.userId===p.userId&&a.mode!=='preview');return {...p,attemptCount:as.length,setCount:new Set(as.map(a=>a.releaseId)).size};});
   if(input.userId){if(!Number.isSafeInteger(input.userId))fail('Некорректный ID.');out.playerAttempts=allAttempts.filter(a=>a.userId===input.userId);const keys=new Set(out.playerAttempts.map(a=>a.id));out.playerAudit=auditRows.filter(a=>String(a.target)===String(input.userId)||keys.has(a.target)||a.before?.userId===input.userId||a.after?.userId===input.userId).sort((a,b)=>b.at.localeCompare(a.at));}
   return out;
  },
  async adminCommand(input,ctx){const actor=admin(ctx),at=now(),action=input.command;
   return store.transact(async v=>{
    if(!Number.isInteger(input.expectedRevision)||v.head.revision!==input.expectedRevision)fail('Данные изменились. Обновите раздел и повторите действие.','CONFLICT');
    const changes=[];let before=null,after=null,target=input.releaseId||input.catalogId||String(input.userId||input.attemptId||'');
    if(action==='saveContent'){
     const s=await val(v,'admin'),c=s.catalog_versions.find(c=>c.id===id(input.catalogId));if(!c)fail('Сохраните набор перед добавлением материалов.','NOT_FOUND');
     before=await val(v,'content:'+c.id);after={...normalizeContent(input.content),catalogId:c.id,updatedAt:at,updatedBy:actor};changes.push(rec('content:'+c.id,'content',after));
    }else if(action==='cloneSet'){
     const s=await val(v,'admin'),from=s.catalog_versions.find(c=>c.id===id(input.sourceId)),newKey=id(input.id);if(!from)fail('Набор не найден.','NOT_FOUND');if(newKey.length>56||s.catalog_versions.some(c=>c.id===newKey)||s.game_releases.some(r=>r.id===newKey))fail('Код нового набора занят или слишком длинный.');
     if(s.catalog_versions.length>=30)fail('Достигнут лимит каталога.','CAPACITY');
     const copy={...clone(from),id:newKey,name:(input.name||from.name+' — копия').slice(0,100),status:'draft',revision:1,playable:null,createdAt:at,updatedAt:at,updatedBy:String(actor)};copy.catalog.id=newKey;copy.catalog.name=copy.name;s.catalog_versions.push(copy);
     const c=await val(v,'content:'+from.id);if(c)changes.push(rec('content:'+newKey,'content',{...c,catalogId:newKey,updatedAt:at,updatedBy:actor}));
     const sourceRelease=s.game_releases.find(r=>r.catalogVersionId===from.id),sourceContest=sourceRelease&&await val(v,'contest:'+sourceRelease.id);
     if(sourceContest)changes.push(rec('contestTemplate:'+newKey,'template',{endsAt:null,rules:clone(sourceContest.rules),note:'Копия настроек, без попыток и сроков исходного выпуска.'}));
     changes.push(rec('admin','admin',s));after={id:newKey};target=newKey;
    }else if(['activate','schedule','extend','close','finalize'].includes(action)){
     const {r,c}=await release(v,id(input.releaseId),true);if(r.status!=='published')fail('Сначала опубликуйте набор.');
     const existing=await val(v,'contest:'+r.id);before=existing;const contest=existing?clone(existing):{id:r.id,releaseId:r.id,catalogVersionId:c.id,catalogDigest:digest(c.playable),name:r.name,rules:clone(RULES),status:'planned',startedAt:null,endsAt:null,closedAt:null,finalizedAt:null};
     if(contest.finalizedAt)fail('Окончательные итоги неизменяемы. Для нового конкурса создайте копию набора.','IMMUTABLE');
     if(action==='schedule'){if(contest.startedAt)fail('Конкурс уже начат.');contest.plannedAt=input.plannedAt||null;if(contest.plannedAt&&!Number.isFinite(Date.parse(contest.plannedAt)))fail('Неверная дата.');}
     if(['activate','extend'].includes(action)){
      if(action==='activate'&&contest.startedAt)fail('Конкурс уже начат; используйте продление.');
      if(action==='extend'&&!contest.startedAt)fail('Конкурс ещё не начат.');
      const endsAt=input.endsAt||null;if(endsAt&&(!Number.isFinite(Date.parse(endsAt))||Date.parse(endsAt)<=Date.parse(at)))fail('Конец конкурса должен быть в будущем.');
      if(action==='extend'&&!endsAt)fail('Укажите новую дату окончания.');
      if(action==='extend'&&contest.endsAt&&Date.parse(endsAt)<=Date.parse(contest.endsAt))fail('Продление должно увеличивать срок.');
      contest.startedAt=contest.startedAt||at;contest.endsAt=endsAt?new Date(endsAt).toISOString():null;contest.closedAt=null;contest.status='active';
     }
     if(action==='close'){if(!contest.startedAt)fail('Конкурс ещё не начат.');contest.status='review';contest.closedAt=at;}
     if(action==='finalize'){
      if(!contest.startedAt||phase(contest,at)==='active')fail('Сначала завершите конкурсное окно.');
      const b=await bundle(v,r.id);if(b.final)fail('Итоги уже опубликованы.','IMMUTABLE');
      if(b.attempts.some(a=>a.mode==='contest'&&!a.voided&&a.check?.status==='pending')&&input.acknowledgePending!==true)fail('Остались попытки для проверки. Проверьте их или явно подтвердите публикацию.','PENDING_REVIEW');
      const rows=leaderboard(b.attempts,b.players),final=immutableFinal(contest,rows,summarize(b.attempts,b.players),actor,at);
      changes.push(rec('final:'+r.id,'final',final));contest.finalizedAt=at;contest.status='archive';
     }
     contest.updatedAt=at;contest.updatedBy=actor;after=contest;changes.push(rec('contest:'+r.id,'contest',contest));
    }else if(['exclude','restorePlayer'].includes(action)){
     const why=reason(input),p=await val(v,'player:'+input.userId);if(!p)fail('Игрок не найден.');before=clone(p);p.excluded=action==='exclude';p.moderatedAt=at;p.moderatedBy=actor;p.moderationReason=why;after=p;changes.push(rec('player:'+p.userId,'player',p));
     // Published positions and names are NEVER overwritten or unpublished.
     const affected=data(await v.list('final')).filter(f=>f.rankings.some(x=>x.userId===p.userId)).map(f=>f.releaseId);if(affected.length)changes.push(rec('final-note:'+newId(),'finalNote',{releaseIds:affected,userId:p.userId,at,actor,reason:why,action,officialSnapshotUnchanged:true}));
     if(changes.length>35)fail('Слишком много исторических выпусков для одной операции. Нужен пакетный режим пометок.','CAPACITY');
    }else if(['approve','review','adjust','voidAttempt'].includes(action)){
     const why=reason(input),a=await val(v,'attempt:'+id(input.attemptId));if(!a)fail('Попытка не найдена.');before=clone(a);
     if(action==='voidAttempt'){a.voided=true;a.voidReason=why;const key=`reservation:${a.releaseId}:${a.userId}`,r=await val(v,key);if(r){r.slots=r.slots.map(s=>s.attemptId===a.id?{...s,voided:true}:s);if(r.activeId===a.id)r.activeId=null;changes.push(rec(key,'reservation',r));}}
     else if(action==='adjust'){if(a.status!=='completed')fail('Сначала требуется завершённый результат.');const score=Number(input.score),accuracy=input.accuracy===undefined?a.calculated.accuracy:Number(input.accuracy);if(!Number.isFinite(score)||!Number.isInteger(score)||Math.abs(score)>1000000||!Number.isFinite(accuracy)||accuracy<0||accuracy>100)fail('Некорректные очки или точность.');a.adjustment={values:{score,accuracy},at,actor,reason:why};}
     else a.check={...(a.check||{reasons:[]}),status:action==='approve'?'approved':'pending',reviewedAt:at,reviewedBy:actor,reason:why};
     after=a;changes.push(rec('attempt:'+a.id,'attempt',a));
     if(await val(v,'final:'+a.releaseId))changes.push(rec('final-note:'+newId(),'finalNote',{releaseId:a.releaseId,userId:a.userId,attemptId:a.id,at,actor,reason:why,action,officialSnapshotUnchanged:true}));
    }else fail('Неизвестное действие.');
    changes.push(audit(at,actor,action,target,before,after,input.reason||''));return {changes,value:{ok:true,id:after?.id||target}};
   });
  },
  async observe(ctx,{allowed,releaseId}){
   // A verified Mini App launch/observed membership transition, NOT a message, share or /start event.
   const uid=verifiedUser(ctx),at=now(),param=String(ctx.initData.start_param||''),authDate=Number(ctx.initData.auth_date)||0;
   const key='visit:'+digest({uid,authDate,param}).slice(0,32);
   return store.transact(async v=>{const old=await val(v,key);if(old&&(allowed!==true||old.firstAllowedAt))return {value:true};const visit={...(old||{}),userId:uid,releaseId:releaseId||old?.releaseId||null,source:/^(set_|release_)/.test(param)?'set_link':'ordinary',firstSeenAt:old?.firstSeenAt||at,lastSeenAt:at,firstAllowedAt:old?.firstAllowedAt||(allowed===true?at:null),firstDeniedAt:old?.firstDeniedAt||(allowed===false?at:null)};return {changes:[rec(key,'visit',visit),await playerChanges(v,ctx,at)],value:true};});
  }
 };
}
