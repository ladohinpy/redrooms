import {fail,object,clone,byteLength} from './domain.js';
import {digest} from './digest.js';
export const CONTEST_VERSION=1;
export const RULES=Object.freeze({version:1,correctPoints:100,errorPenalty:75,maxAttempts:2});
export const GAMEPLAY_LIMITS=Object.freeze({events:10000,payloadBytes:1048576});
export function requestId(x){if(typeof x!=='string'||!/^[a-zA-Z0-9_-]{8,100}$/.test(x))fail('Некорректный идентификатор запроса.');return x;}
export function endTime(c){const ts=[c?.endsAt,c?.closedAt].filter(Boolean).map(x=>Date.parse(x));return ts.length?Math.min(...ts):Infinity;}
export function phase(c,now){if(!c)return 'practice';if(c.finalizedAt)return 'archive';if(!c.startedAt)return 'planned';return Date.parse(now)>=endTime(c)||c.status==='review'?'review':'active';}
export function profile(user,previous,at){return {...(previous||{}),userId:user.id,username:typeof user.username==='string'&&/^[a-zA-Z0-9_]{1,32}$/.test(user.username)?user.username:null,name:[user.first_name,user.last_name].filter(x=>typeof x==='string').join(' ').slice(0,160)||'Участник',firstSeenAt:previous?.firstSeenAt||at,lastSeenAt:at,excluded:previous?.excluded===true};}
/** Recompute facts, never accept score/accuracy/userId from the client. Keep anomalies for human review. */
export function calculateAttempt(snapshot,input,attempt,receivedAt){
 object(input,'Результат');if(byteLength(JSON.stringify(input))>GAMEPLAY_LIMITS.payloadBytes)fail('Результат слишком большой.','TOO_LARGE');
 const films=snapshot.directors.flatMap(d=>d.films.map(f=>({...f,tableId:d.id}))),byId=new Map(films.map(f=>[f.id,f])),tables=new Set(snapshot.directors.map(d=>d.id));
 if(!Array.isArray(input.actions)||input.actions.length>GAMEPLAY_LIMITS.events)fail('Нужен список размещений допустимого размера.');
 if(!Array.isArray(input.answers)||input.answers.length>films.length*2+16)fail('Некорректный список ответов.');
 const flags=new Set(),placed=new Map(),seen=new Set(),rawActions=[],rawAnswers=[],wrongFilms=Object.create(null);let errors=0,switches=0,lastTable=null,validActions=0,sequence=-1;
 for(const e0 of input.actions){object(e0,'Действие');const e={filmId:String(e0.filmId??'').slice(0,64),tableId:String(e0.tableId??'').slice(0,64),seq:Number(e0.seq)};rawActions.push(e);
  if(!Number.isSafeInteger(e.seq)||e.seq<=sequence)flags.add('event_order');sequence=e.seq;
  const f=byId.get(e.filmId);if(!f||!tables.has(e.tableId)){flags.add('unknown_event_item');continue;}
  validActions++;if(lastTable!==null&&lastTable!==e.tableId)switches++;lastTable=e.tableId;
  if(placed.has(f.id)){flags.add('already_placed');continue;}
  if(f.tableId===e.tableId)placed.set(f.id,e.tableId);else {errors++;wrongFilms[f.id]=(wrongFilms[f.id]||0)+1;}
 }
 let correct=0;
 for(const a0 of input.answers){object(a0,'Ответ');const a={filmId:String(a0.filmId??'').slice(0,64),tableId:String(a0.tableId??'').slice(0,64)};rawAnswers.push(a);if(seen.has(a.filmId)){flags.add('duplicate_answer');continue;}seen.add(a.filmId);const f=byId.get(a.filmId);if(!f||!tables.has(a.tableId)){flags.add('unknown_answer');continue;}if(f.tableId===a.tableId)correct++;else flags.add('incorrect_final_placement');if(placed.get(a.filmId)!==a.tableId)flags.add('events_answers_mismatch');}
 if(correct!==films.length)flags.add('incomplete');if(validActions<correct)flags.add('insufficient_actions');if(placed.size!==correct)flags.add('placement_count');
 const supplied=input.counters||{};if(Number.isFinite(supplied.switches)&&supplied.switches!==switches)flags.add('switches_mismatch');if(Number.isFinite(supplied.placements)&&supplied.placements!==input.actions.length)flags.add('actions_mismatch');
 const elapsedMs=Math.max(0,Date.parse(receivedAt)-Date.parse(attempt.startedAt));
 if(elapsedMs<films.length*300)flags.add('very_short');
 const tries=correct+errors,score=correct*100-errors*75,accuracy=tries?Math.round(correct/tries*100):0;
 return {raw:{answers:rawAnswers,actions:rawActions,counters:{placements:input.actions.length,switches,...(Number.isFinite(supplied.seconds)?{clientSeconds:Math.max(0,supplied.seconds)}:{})}},calculated:{score,accuracy,correct,total:films.length,errors,tries,switches,durationMs:elapsedMs,wrongFilms,rulesVersion:1},check:{status:flags.size?'pending':'clean',reasons:[...flags],at:receivedAt},fingerprint:digest({answers:rawAnswers,actions:rawActions})};
}
export function effective(a){return {...a.calculated,...(a.adjustment?.values||{})};}
export function leaderboard(attempts,players){
 const playerById=new Map(players.map(p=>[p.userId,p])),best=new Map();
 for(const a of attempts){if(a.mode!=='contest'||a.status!=='completed'||!a.eligible||a.voided||playerById.get(a.userId)?.excluded)continue;const prior=best.get(a.userId);if(!prior||effective(a).score>effective(prior).score)best.set(a.userId,a);}
 const rows=[...best.values()].map(a=>{const p=playerById.get(a.userId)||{};return {userId:a.userId,name:p.name||'Участник',username:p.username||null,attemptId:a.id,...effective(a),finishedAt:a.finishedAt};}).sort((a,b)=>b.score-a.score||a.finishedAt.localeCompare(b.finishedAt)||a.userId-b.userId);
 let last=null,place=0;rows.forEach((x,i)=>{if(last!==x.score)place=i+1;x.place=place;last=x.score;});return rows;
}
export function summarize(attempts,players){
 const competitive=attempts.filter(a=>a.mode==='contest'&&!a.voided),completed=competitive.filter(a=>a.status==='completed'),users=new Set(competitive.map(a=>a.userId)),finished=new Set(completed.map(a=>a.userId)),ranks=leaderboard(attempts,players);
 const mistakes=Object.create(null);for(const a of completed)for(const [id,n]of Object.entries(a.calculated?.wrongFilms||{}))mistakes[id]=(mistakes[id]||0)+n;
 return {participants:users.size,finished:finished.size,attempts:competitive.length,completed:completed.length,seconds:new Set(competitive.filter(a=>a.slot===2).map(a=>a.userId)).size,meanBest:ranks.length?Math.round(ranks.reduce((n,r)=>n+r.score,0)/ranks.length*100)/100:0,max:ranks.length?ranks[0].score:0,completionRate:users.size?Math.round(finished.size/users.size*100):0,pending:attempts.filter(a=>a.mode==='contest'&&a.check?.status==='pending'&&!a.voided).length,archiveAttempts:attempts.filter(a=>a.mode==='archive').length,late:completed.filter(a=>!a.eligible).length,mistakes};
}
export function publicAttempt(a){if(!a)return null;return {id:a.id,slot:a.slot,mode:a.mode,status:a.status,startedAt:a.startedAt,finishedAt:a.finishedAt||null,eligible:a.eligible===true,voided:a.voided===true,result:a.calculated?effective(a):null};}
export function publicRanking(rows,uid){return rows.map((r,i)=>({place:r.place,name:r.username?'@'+r.username:r.name,score:r.score,accuracy:r.accuracy,isMe:r.userId===uid}));}
export function immutableFinal(contest,rankings,stats,actor,at){return {contestId:contest.id,releaseId:contest.releaseId,publishedAt:at,publishedBy:actor,rules:clone(contest.rules),title:contest.name,rankings:clone(rankings),stats:clone(stats),version:1};}
