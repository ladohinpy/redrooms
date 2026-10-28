/** Client outbox is deliberately separate from the existing game save. Identity,
 * limits and score always come from the server. Client storage never grants rights. */
import {el,call,telegram,copy,navigate,notify} from './client.mjs';
import {contentBlock,shareSet} from './rich-text.mjs';
const clone=x=>JSON.parse(JSON.stringify(x));
const reqid=()=>{try{const id=globalThis.crypto?.randomUUID?.();if(id)return id;}catch{}return Date.now().toString(36)+'-'+Math.random().toString(36).slice(2)+Math.random().toString(36).slice(2);};
/** Entry copy is editorial content, never a fallback release name or contest mode. */
export function renderPlayerIntro(container, block = {}) {
 if (!container) return;
 const value=block && typeof block==='object' ? block : {};
 const authored=['title','text','url'].some(key=>typeof value[key]==='string' && value[key].trim());
 container.replaceChildren();
 container.hidden=!authored;
 if (authored) container.append(contentBlock(value));
}
export function validateStartAttempt(reply) {
 const a=reply?.attempt;
 if(!a||typeof a.id!=='string'||!a.id||!['started','completed','unfinished'].includes(a.status)||
    !['contest','practice','archive','preview'].includes(a.mode)||typeof a.startedAt!=='string'||
    !Number.isFinite(Date.parse(a.startedAt))) {
  throw Object.assign(new Error('Не удалось подтвердить состояние игры. Повторите вход; сохранённые данные не удалены.'),{code:'ATTEMPT_RESPONSE_INVALID',localMessage:true});
 }
 return a;
}
const isClosedAttempt=a=>a && (a.status==='completed'||a.status==='unfinished'||a.voided===true);
export async function createContestClient(data) {
 const rid=data.release.id,base=window.RR_SAVE_PREFIX,key=`rr:contest:1:${data.userId}:${rid}`;
 const preview=!!data.previewCatalogId;
 let lobby=preview?data.previewLobby:await call('rrContest',{action:'lobby',releaseId:rid}),ledger=null,running=false,starting=null,sending=null,win=null,closedAtLoad=null,restoredReceipt=false;
 try{ledger=JSON.parse(localStorage.getItem(key)||'null');}catch{}
 if(ledger?.version!==1||ledger.releaseId!==rid)ledger=null;
 const persist=()=>{try{localStorage.setItem(key,JSON.stringify(ledger));}catch{throw new Error('Сохранение на устройстве недоступно. Освободите место или откройте игру в другом клиенте.');}};
 const ensureStorage=()=>{const k=key+':probe';localStorage.setItem(k,'1');localStorage.removeItem(k);};
 // Reconcile only with authenticated server records. Never infer a consumed or
 // finished attempt from localStorage, and never discard a pending finish.
 if(!preview&&ledger?.attemptId&&!ledger.pending){
  const known=(lobby.attempts||[]).find(a=>a.id===ledger.attemptId);
  if(isClosedAttempt(known)){
   closedAtLoad=validateStartAttempt({attempt:known});
   if(known.status==='completed'&&!known.voided&&!ledger.receipt){
    ledger.receipt={...lobby,saved:true,attempt:known};persist();restoredReceipt=true;
   }
  }
 }
 const prefix=a=>base+(a && ['contest','preview'].includes(a.mode)?`attempt:${a.id}:`:'');
 if(lobby.active)window.RR_SAVE_PREFIX=prefix(lobby.active);
 // A newly reserved contest/preview must never inherit an old practice save.
 else if(closedAtLoad||lobby.phase==='active'||lobby.isAdmin)window.RR_SAVE_PREFIX=base+'unstarted:';
 const button=(label,fn)=>el('button',{type:'button',class:'secondary',text:label,onclick:async()=>{try{await fn();}catch(e){notify(playerError(e),true);}}});
 function playerError(e){return ({ATTEMPTS_EXHAUSTED:'Обе конкурсные попытки уже использованы.',ATTEMPT_CLOSED:'Эта попытка уже закрыта. Обновите игру.',SUBSCRIPTION_REQUIRED:'Для игры нужна подписка на канал «Витальное кино».',CONFLICT:'Запрос ещё обрабатывается. Повторите действие.',TIMEOUT:'Связь прервалась. Сохранённый результат останется на устройстве.'})[e?.code] || (e?.localMessage?e.message:'Не удалось связаться с игрой. Повторите действие; результат останется на устройстве.');}
 function localError(message){return Object.assign(new Error(message),{localMessage:true});}
 function linkActions(text){if(preview)return el('p',{class:'small-note',text:'Предпросмотр черновика: публикации и общедоступной ссылки ещё нет.'});const row=el('div',{class:'win-actions rr-share-actions'});try{const l=shareSet(lobby.botUsername,rid,text);row.append(button('Поделиться этой игрой',async()=>{const t=await telegram();t.openTelegramLink(l.shareUrl);}),button('Копировать ссылку',()=>copy(l.url)));}catch{}return row;}
 const reload=()=>navigate(location.pathname,preview?{previewCatalogId:data.previewCatalogId}:{release:rid},true);
 async function rankings(){const result=preview?{rows:[],finalized:false}:await call('rrContest',{action:'leaderboard',releaseId:rid});const dialog=el('dialog',{class:'rr-results-dialog'},el('h2',{text:result.finalized?'Окончательные итоги':'Предварительные результаты'}));dialog.append(...result.rows.map(r=>el('p',{text:`${r.place}. ${r.name} — ${r.score} очков · ${r.accuracy}%${r.isMe?' · вы':''}`})));if(!result.rows.length)dialog.append(el('p',{text:'Пока нет зачётных результатов.'}));dialog.append(button('Закрыть',()=>{dialog.close();dialog.remove();}));document.body.append(dialog);dialog.showModal();}
 // Show recovery controls only for an actual interrupted attempt, not as a permanent lobby.
 function recovery(){
  const box=el('section',{id:'rr-attempt-recovery',role:'status'}),active=lobby.active;
  if(active&&(!ledger||ledger.attemptId!==active.id)){
   box.append(el('p',{class:'rr-warning',text:'Начатая игра не сохранилась на этом устройстве. Можно завершить её без результата; использованная попытка не возвращается.'}),button('Завершить потерянную попытку без результата',async()=>{if(!confirm('Эта попытка останется использованной. Продолжить?'))return;await call('rrContest',{action:'abandon',attemptId:active.id});reload();}));
  }
  if(closedAtLoad&&!active&&!ledger?.pending&&closedAtLoad.status!=='completed')
   box.append(el('p',{class:'rr-warning',text:closedAtLoad.voided?'Предыдущая игра аннулирована администратором. Следующее начало проверит сервер.':'Предыдущее прохождение закрыто без результата. Можно начать следующую игру, если остались доступные попытки.'}));
  return box;
 }
 function attach(){
  const card=document.querySelector('#start .start-card'),startButton=document.getElementById('startButton');
  renderPlayerIntro(document.getElementById('rr-player-intro'),lobby.content?.intro);
  document.getElementById('rr-attempt-recovery')?.remove();
  const help=recovery();
  if(card && startButton && help.childNodes.length)card.insertBefore(help,startButton);
  if(startButton&&closedAtLoad&&!lobby.active&&!ledger?.pending)startButton.textContent='Начать следующую игру';
  if(restoredReceipt)showSavedResult();
  if(startButton&&!lobby.active&&lobby.phase==='active'&&lobby.remaining===0&&!lobby.isAdmin){startButton.textContent='Обе попытки использованы';startButton.disabled=true;}
  if(ledger?.pending){win=document.getElementById('win');if(win){win.hidden=false;renderFinish();void send().catch(()=>{});}}
 }
 function showSavedResult(){
  win=document.getElementById('win');if(win){win.hidden=false;renderFinish();}
 }
 function freshLedger(){
  // Keep a bounded local copy of a server-confirmed closed ledger. This is not a
  // database reset and cannot refund a competitive slot. Never back up over an outbox.
  if(ledger?.pending)throw localError('Сначала отправьте сохранённый результат.');
  if(ledger?.attemptId)localStorage.setItem(key+':previous-closed',JSON.stringify(ledger));
  ledger={version:1,releaseId:rid,requestId:reqid(),attemptId:null,actions:[],pending:null,receipt:null};persist();
 }
 async function reconcileClosedReply(attempt){
  const state=await call('rrContest',{action:'lobby',releaseId:rid});
  const known=(state.attempts||[]).find(a=>a.id===attempt.id);
  if(!isClosedAttempt(known))throw localError('Состояние игры изменилось. Повторите вход; сохранённые данные не удалены.');
  validateStartAttempt({attempt:known});
  if(ledger?.attemptId&&ledger.attemptId!==known.id)throw localError('Состояние попытки изменилось. Сохранённый прогресс оставлен на устройстве.');
  lobby=state;ledger.attemptId=known.id;ledger.mode=known.mode;ledger.startedAt=known.startedAt;
  if(known.status==='completed'&&!known.voided){
   ledger.receipt={...state,saved:true,attempt:known};persist();showSavedResult();
  }else{
   // Reload the world before a fresh attempt: never inherit old cassette positions.
   persist();reload();
  }
  return false;
 }
 function entryStatus(text,error=false){
  let box=document.getElementById('rr-start-status');
  if(!box){const start=document.getElementById('startButton');if(!start)return;box=el('p',{id:'rr-start-status',role:'status','aria-live':'polite'});start.before(box);}
  box.textContent=text;box.hidden=!text;box.classList.toggle('error',error);
 }
 async function ensureStart(){
  if(running)return true;if(starting)return starting;
  starting=(async()=>{
   try{ensureStorage();}catch{throw localError('Сохранение на устройстве недоступно. Попытка не начата.');}
   if(ledger?.pending){showSavedResult();throw localError('Сначала отправьте сохранённый результат.');}
   // A lobby can become stale in another tab/device; check before consuming a slot.
   if(!preview)lobby=await call('rrContest',{action:'lobby',releaseId:rid});
   const known=!preview&&ledger?.attemptId?(lobby.attempts||[]).find(a=>a.id===ledger.attemptId):null;
   if(isClosedAttempt(known)){
    validateStartAttempt({attempt:known});
    if(!closedAtLoad||closedAtLoad.id!==known.id)return reconcileClosedReply(known);
    if(lobby.active&&lobby.active.id!==known.id)throw localError('Другая попытка уже начата. Её прогресс не найден на этом устройстве. Новая попытка автоматически не выдаётся.');
    if(lobby.phase==='active'&&!lobby.isAdmin&&lobby.remaining===0)throw Object.assign(new Error('Обе конкурсные попытки уже использованы.'),{code:'ATTEMPTS_EXHAUSTED'});
    freshLedger();closedAtLoad=null;restoredReceipt=false;
   }
   const unconfirmed=ledger?.requestId&&!ledger.attemptId&&!ledger.actions?.length;
   if(lobby.active&&ledger?.attemptId!==lobby.active.id&&!unconfirmed)throw localError('Прогресс начатой попытки не найден. Обратитесь к администратору или завершите потерянную попытку без результата.');
   if(lobby.active&&ledger?.actions?.length&&ledger.gameKey&&!localStorage.getItem(ledger.gameKey))throw localError('Игровое сохранение потеряно. Новая попытка автоматически не выдаётся. Обратитесь к администратору.');
   if(!ledger||ledger.receipt||!ledger.requestId){
    if(ledger?.receipt&&!preview&&!known)throw localError('Сохранённый результат не найден в текущей базе. Обратитесь к администратору; данные на устройстве сохранены.');
    freshLedger();
   }
   const reply=preview?{attempt:{id:'preview-'+ledger.requestId,status:'started',mode:'preview',startedAt:new Date().toISOString()},resumed:false}:await call('rrContest',{action:'start',releaseId:rid,requestId:ledger.requestId});
   const attempt=validateStartAttempt(reply);
   if(isClosedAttempt(attempt))return reconcileClosedReply(attempt);
   if(ledger.attemptId&&ledger.attemptId!==attempt.id)throw localError('Состояние попытки изменилось. Сохранённый прогресс оставлен на устройстве.');
   if(!ledger.attemptId&&reply.resumed===true&&reply.createdByRequest!==true)throw localError('Прогресс начатой попытки не найден. Новая попытка автоматически не выдаётся. Обратитесь к администратору.');
   ledger.attemptId=attempt.id;ledger.mode=attempt.mode;ledger.startedAt=attempt.startedAt;persist();window.RR_SAVE_PREFIX=prefix(attempt);running=true;return true;
  })();
  try{return await starting;}catch(error){window.RR_ENTRY_FAILURE={stage:'start',code:/^[A-Z_]{1,50}$/.test(error?.code||'')?error.code:'START_FAILED'};throw error;}finally{starting=null;}
 }

 function record(filmId,tableId){if(!running||!ledger?.attemptId)throw localError('Попытка ещё не зарегистрирована.');if(ledger.actions.length>=10000)throw localError('Слишком много действий. Приостановите игру и обратитесь к администратору.');ledger.actions.push({seq:ledger.actions.length+1,filmId,tableId});try{persist();}catch(e){ledger.actions.pop();throw e;}}
 function localState(gameKey){if(ledger){ledger.gameKey=gameKey;persist();}return ledger?{attemptId:ledger.attemptId,actions:clone(ledger.actions)}:null;}
 function restoreLocal(state){if(!state||!ledger||state.attemptId!==ledger.attemptId||ledger.pending)return; if(Array.isArray(state.actions))ledger.actions=clone(state.actions);persist();}
 function queueFinish(payload,gameKey){if(!ledger?.attemptId)throw localError('Нет серверной попытки.');ledger.gameKey=gameKey;ledger.pending={attemptId:ledger.attemptId,answers:payload.answers,actions:clone(ledger.actions),counters:{placements:ledger.actions.length,seconds:payload.seconds}};persist();running=false;}
 async function send(){
  if(sending)return sending;if(!ledger?.pending)return ledger?.receipt;
  sending=(async()=>{try{const result=await call('rrContest',preview?{action:'preview',operation:'finish',catalogId:data.previewCatalogId,requestId:ledger.requestId,startedAt:ledger.startedAt,...ledger.pending}:{action:'finish',...ledger.pending});ledger.receipt=result;ledger.pending=null;persist();if(ledger.gameKey)localStorage.removeItem(ledger.gameKey);lobby={...lobby,...result};renderFinish();return result;}catch(e){renderFinish(playerError(e));throw e;}finally{sending=null;}})();return sending;
 }
 function renderFinish(error=''){
  if(!win)return;const receipt=ledger?.receipt,a=receipt?.attempt,r=a?.result,box=el('div',{class:'start-card rr-contest-finish'});
  box.append(el('div',{class:'eyebrow',text:'«Витальное кино» · '+lobby.name}),el('h2',{text:receipt?'Комната разобрана':'Сохраняем результат'}));
  if(!receipt){box.append(el('p',{text:error||'Результат остаётся на устройстве до подтверждения сервера. Не очищайте данные приложения.'}),button('Повторить отправку',send));}
  else {
   box.append(el('p',{class:'rr-score',text:`${r?.score??0} очков · ${r?.accuracy??0}% точности`}),el('p',{text:`Верных размещений: ${r?.correct??0} / ${r?.total??0}. Ошибок: ${r?.errors??0}.`}));
   if(a.mode==='preview')box.append(el('p',{text:'Предпросмотр администратора. Результат не участвует в конкурсе.'}));
   else if(a.mode==='contest'&&!a.eligible)box.append(el('p',{text:'Результат сохранён после окончания конкурсного окна и не входит в зачёт.'}));
   else if(a.mode!=='contest')box.append(el('p',{text:'Свободное прохождение, без изменения конкурсных итогов.'}));
   box.append(contentBlock(r?.accuracy>=lobby.content.successThreshold?lobby.content.success:lobby.content.failure));
   const ranked=(receipt.attempts||[]).filter(a=>a.mode==='contest'&&!a.voided);if(ranked.length){box.append(el('h3',{text:'Ваши попытки'}),...ranked.map(a=>el('p',{text:`Попытка ${a.slot}: ${a.result?a.result.score+' очков · '+a.result.accuracy+'%':a.status==='started'?'не завершена':'без результата'}`})));const own=receipt.rankings?.find(x=>x.isMe);if(own)box.append(el('p',{text:`${receipt.finalized?'Окончательное':'Текущее'} место: ${own.place}. В зачёт идёт лучший результат.`}));}
   if((lobby.phase==='active'&&lobby.remaining>0)||lobby.isAdmin||lobby.phase!=='active')box.append(button(lobby.phase==='active'&&!lobby.isAdmin?'Попробовать ещё раз':'Сыграть ещё раз',restart));
  }
  box.append(linkActions(receipt?`У меня ${r?.accuracy??0}% в наборе «${lobby.name}». Попробуй сыграть!`:`Сыграй в набор «${lobby.name}».`),button('Таблица результатов',rankings));
  if(lobby.content.articleAvailable&&lobby.content.article)box.append(el('details',{},el('summary',{text:lobby.content.article.title||'Авторский разбор'}),contentBlock(lobby.content.article)));else if(lobby.content.articleTitle)box.append(el('p',{class:'small-note',text:'Авторский разбор откроется после конкурса или исчерпания попыток — по правилам этого выпуска.'}));
  win.replaceChildren(box);
 }
 async function finish(winElement){win=winElement;renderFinish();return send();}
 async function restart(){if(ledger?.pending){await send();if(ledger.pending)return;}if(ledger?.attemptId&&!ledger.receipt){if(!confirm('Прервать текущую попытку? Она останется использованной.'))return;if(!preview)await call('rrContest',{action:'abandon',attemptId:ledger.attemptId});}if(ledger?.gameKey)localStorage.removeItem(ledger.gameKey);localStorage.removeItem(key);reload();}
 addEventListener('online',()=>{if(ledger?.pending)void send().catch(()=>{});});
 let retryTimer=setInterval(()=>{if(ledger?.pending&&navigator.onLine)void send().catch(()=>{});},20000);addEventListener('pagehide',()=>clearInterval(retryTimer),{once:true});
 return {get running(){return running;},entryStatus,attach,ensureStart,record,localState,restoreLocal,queueFinish,finish,restart,publicError:playerError};
}
