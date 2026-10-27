/** Client outbox is deliberately separate from the existing game save. Identity,
 * limits and score always come from the server. Client storage never grants rights. */
import {el,call,telegram,copy,navigate,notify} from './client.mjs';
import {contentBlock,shareSet} from './rich-text.mjs';
const clone=x=>JSON.parse(JSON.stringify(x));
const reqid=()=>globalThis.crypto?.randomUUID?.()||Date.now().toString(36)+'-'+Math.random().toString(36).slice(2)+Math.random().toString(36).slice(2);
export async function createContestClient(data) {
 const rid=data.release.id,base=window.RR_SAVE_PREFIX,key=`rr:contest:1:${data.userId}:${rid}`;
 const preview=!!data.previewCatalogId;
 let lobby=preview?data.previewLobby:await call('rrContest',{action:'lobby',releaseId:rid}),ledger=null,running=false,starting=null,sending=null,win=null;
 try{ledger=JSON.parse(localStorage.getItem(key)||'null');}catch{}
 if(ledger?.version!==1||ledger.releaseId!==rid)ledger=null;
 const persist=()=>{try{localStorage.setItem(key,JSON.stringify(ledger));}catch{throw new Error('Сохранение на устройстве недоступно. Освободите место или откройте игру в другом клиенте.');}};
 const ensureStorage=()=>{const k=key+':probe';localStorage.setItem(k,'1');localStorage.removeItem(k);};
 const prefix=a=>base+(a && ['contest','preview'].includes(a.mode)?`attempt:${a.id}:`:'');
 if(lobby.active)window.RR_SAVE_PREFIX=prefix(lobby.active);
 // A newly reserved contest/preview must never inherit an old practice save.
 else if(lobby.phase==='active'||lobby.isAdmin)window.RR_SAVE_PREFIX=base+'unstarted:';
 const button=(label,fn)=>el('button',{type:'button',class:'secondary',text:label,onclick:async()=>{try{await fn();}catch(e){notify(playerError(e),true);}}});
 function playerError(e){return ({ATTEMPTS_EXHAUSTED:'Обе конкурсные попытки уже использованы.',ATTEMPT_CLOSED:'Эта попытка уже закрыта. Обновите игру.',SUBSCRIPTION_REQUIRED:'Для игры нужна подписка на канал «Витальное кино».',CONFLICT:'Запрос ещё обрабатывается. Повторите действие.',TIMEOUT:'Связь прервалась. Сохранённый результат останется на устройстве.'})[e?.code] || (e?.localMessage?e.message:'Не удалось связаться с игрой. Повторите действие; результат останется на устройстве.');}
 function localError(message){return Object.assign(new Error(message),{localMessage:true});}
 function linkActions(text){if(preview)return el('p',{class:'small-note',text:'Предпросмотр черновика: публикации и общедоступной ссылки ещё нет.'});const row=el('div',{class:'win-actions rr-share-actions'});try{const l=shareSet(lobby.botUsername,rid,text);row.append(button('Поделиться этой игрой',async()=>{const t=await telegram();t.openTelegramLink(l.shareUrl);}),button('Копировать ссылку',()=>copy(l.url)));}catch{}return row;}
 const reload=()=>navigate(location.pathname,preview?{previewCatalogId:data.previewCatalogId}:{release:rid},true);
 function summary(){
  if(lobby.isAdmin)return 'Тестовый режим администратора. Прохождение не попадёт в конкурсную статистику.';
  if(lobby.phase==='active')return `Две конкурсные попытки. Осталось: ${lobby.remaining}. В зачёт идёт лучший результат. +100 за верный стол, −75 за ошибку.`;
  if(lobby.phase==='review')return 'Конкурс завершён, идёт подведение итогов. Сейчас можно играть вне зачёта.';
  if(lobby.phase==='archive')return 'Архивный выпуск. Можно играть снова, опубликованные итоги не изменятся.';
  return 'Свободное прохождение. Конкурс для этого набора ещё не начат.';
 }
 async function rankings(){const result=preview?{rows:[],finalized:false}:await call('rrContest',{action:'leaderboard',releaseId:rid});const dialog=el('dialog',{class:'rr-results-dialog'},el('h2',{text:result.finalized?'Окончательные итоги':'Предварительные результаты'}));dialog.append(...result.rows.map(r=>el('p',{text:`${r.place}. ${r.name} — ${r.score} очков · ${r.accuracy}%${r.isMe?' · вы':''}`})));if(!result.rows.length)dialog.append(el('p',{text:'Пока нет зачётных результатов.'}));dialog.append(button('Закрыть',()=>{dialog.close();dialog.remove();}));document.body.append(dialog);dialog.showModal();}
 function intro(){const box=el('section',{id:'rr-contest-intro'},el('h2',{text:lobby.name}),contentBlock(lobby.content.intro),el('p',{class:'small-note',text:summary()}),linkActions(`Попробуй набор «${lobby.name}» в «Красной комнате».`));box.append(button('Посмотреть рейтинг',rankings));
  const active=lobby.active;
  if(active&&(!ledger||ledger.attemptId!==active.id)){box.append(el('p',{class:'rr-warning',text:'На сервере есть начатая попытка, но её прогресс на этом устройстве не найден. Бесплатная новая попытка не выдаётся.'}),button('Завершить потерянную попытку без результата',async()=>{if(!confirm('Эта попытка останется использованной. Продолжить?'))return;await call('rrContest',{action:'abandon',attemptId:active.id});reload();}));}
  if(ledger?.pending)box.append(el('p',{text:'Есть завершённый результат, который ещё не подтверждён сервером.'}),button('Отправить сохранённый результат',async()=>{await send();reload();}));
  return box;
 }
 function attach(){
  const card=document.querySelector('#start .start-card'),startButton=document.getElementById('startButton');
  if(card&&!document.getElementById('rr-contest-intro'))card.insertBefore(intro(),card.querySelector('.controls'));
  if(startButton&&!lobby.active&&lobby.phase==='active'&&lobby.remaining===0&&!lobby.isAdmin){startButton.textContent='Обе попытки использованы';startButton.disabled=true;}
  if(ledger?.pending){win=document.getElementById('win');if(win){win.hidden=false;renderFinish();void send().catch(()=>{});}}
 }
 async function ensureStart(){
  if(running)return true;if(starting)return starting;
  starting=(async()=>{
   try{ensureStorage();}catch{throw localError('Сохранение на устройстве недоступно. Попытка не начата.');}
   if(ledger?.pending){if(!win)win=document.getElementById('win');if(win){win.hidden=false;renderFinish();}throw localError('Сначала отправьте сохранённый результат.');}
   if(lobby.active&&(!ledger||ledger.attemptId!==lobby.active.id))throw localError('Прогресс начатой попытки не найден. Обратитесь к администратору или завершите потерянную попытку без результата.');
   if(lobby.active&&ledger?.actions?.length&&ledger.gameKey&&!localStorage.getItem(ledger.gameKey))throw localError('Игровое сохранение потеряно. Новая попытка автоматически не выдаётся. Обратитесь к администратору.');
   if(!ledger||ledger.receipt||!ledger.requestId){ledger={version:1,releaseId:rid,requestId:reqid(),attemptId:null,actions:[],pending:null,receipt:null};persist();}
   const reply=preview?{attempt:{id:'preview-'+ledger.requestId,status:'started',mode:'preview',startedAt:new Date().toISOString()}}:await call('rrContest',{action:'start',releaseId:rid,requestId:ledger.requestId});
   if(reply.attempt.status!=='started')throw localError('Эта попытка уже завершена. Откройте игру заново.');
   if(ledger.attemptId&&ledger.attemptId!==reply.attempt.id)throw localError('Состояние попытки изменилось. Откройте игру заново.');
   ledger.attemptId=reply.attempt.id;ledger.mode=reply.attempt.mode;ledger.startedAt=reply.attempt.startedAt;persist();window.RR_SAVE_PREFIX=prefix(reply.attempt);running=true;return true;
  })();
  try{return await starting;}finally{starting=null;}
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
 return {get running(){return running;},attach,ensureStart,record,localState,restoreLocal,queueFinish,finish,restart,publicError:playerError};
}
