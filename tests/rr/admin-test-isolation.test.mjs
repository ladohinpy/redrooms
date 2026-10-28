/** Real server service + local SQLite. No network, no live Telegram or production writes. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture,ctx,games} from './package1-helpers.mjs';
import {createContestService} from '../../src/rr/contest-service.mjs';
import {parseBackup} from '../../src/rr/backup.mjs';
const rid='classic-1';
const ft=(name,fn)=>test('admin tests isolation: '+name,async t=>{
 const f=await fixture();t.after(()=>f.close());await fn(f);
});
const get=async(f,key)=>(await f.store.view(await f.store.head()).get(key))?.data;
const records=async f=>f.store.view(await f.store.head()).list();
const put=async(f,items)=>f.store.transact(async()=>({changes:items,value:true}));
const finish=async(f,a,uid,errors=0)=>{f.advance(5000);return f.service.finish({attemptId:a.id,...f.payload(errors)},ctx(uid));};
const serviceFor=(f,ids)=>createContestService({store:f.store,adminIds:ids,checkSubscription:async()=>({allowed:true}),now:f.now,newId:f.newId});

for(const uid of [101,202])ft('configured admin '+uid+' can complete six tests without spending any contest slot',async f=>{
 await f.command('activate');
 for(let n=0;n<6;n++){
  const start=await f.start(uid,'unlimited-admin-'+uid+'-'+n);assert.equal(start.attempt.mode,'preview');assert.equal(start.attempt.slot,null);
  const reply=await finish(f,start.attempt,uid,n%2);assert.equal(reply.attempt.eligible,false);
  assert.equal(reply.remaining,null);assert.equal(reply.attemptLimit,null);assert.equal(reply.unlimitedAttempts,true);
 }
 const reservation=await get(f,`reservation:${rid}:${uid}`);assert.deepEqual(reservation.slots,[]);assert.equal(reservation.activeId,null);
 const report=await f.service.adminRead({releaseId:rid},ctx(101));assert.equal(report.stats.attempts,0);assert.equal(report.stats.participants,0);assert.deepEqual(report.rankings,[]);assert.deepEqual(report.players,[]);
 const inspect=await f.service.adminRead({includeAdminTests:true,userId:uid},ctx(202));assert.equal(inspect.players[0].totalAttemptCount,0);assert.equal(inspect.players[0].totalSetCount,0);assert.equal(inspect.players[0].testAttemptCount,6);assert.equal(inspect.playerAttempts.length,6);
});
ft('preview remains unlimited before, during and after competition',async f=>{
 const steps=[async()=>{},()=>f.command('schedule',{plannedAt:'2026-10-30T10:00:00Z'}),()=>f.command('activate'),()=>f.command('close'),()=>f.command('finalize')];
 for(let phase=0;phase<steps.length;phase++){
  await steps[phase]();for(let n=0;n<3;n++){const a=(await f.start(101,`phase-${phase}-test-${n}`)).attempt;assert.equal(a.mode,'preview');await finish(f,a,101);}
 }
 assert.equal((await f.service.adminRead({includeAdminTests:true},ctx(101))).players[0].testAttemptCount,15);
 assert.equal((await get(f,'final:'+rid)).stats.attempts,0);
});
ft('ordinary player still has exactly two contest attempts and cannot forge preview',async f=>{
 await f.command('activate');
 for(let n=0;n<2;n++){
  const a=(await f.service.start({releaseId:rid,requestId:'ordinary-test-'+n,userId:101,isAdmin:true,mode:'preview',adminIds:[303,404]},ctx(303))).attempt;
  assert.equal(a.mode,'contest');assert.equal(a.slot,n+1);const r=await finish(f,a,303);assert.equal(r.remaining,1-n);assert.equal(r.attemptLimit,2);assert.equal(r.unlimitedAttempts,false);
 }
 await assert.rejects(f.start(303,'ordinary-third-request'),e=>e.code==='ATTEMPTS_EXHAUSTED');
 const r=await f.service.adminRead({releaseId:rid},ctx(101));assert.equal(r.stats.participants,1);assert.equal(r.stats.attempts,2);assert.equal(r.players[0].totalAttemptCount,2);
});
ft('admin lost or abandoned test does not require manual exclusion or void',async f=>{
 await f.command('activate');for(let i=0;i<7;i++){
  const a=(await f.start(202,'abandoned-preview-'+i)).attempt;await f.service.abandon({attemptId:a.id},ctx(202));
 }
 const a=(await f.start(202,'after-seven-tests')).attempt;assert.equal(a.mode,'preview');assert.equal(a.status,'started');
 assert.equal((await get(f,'player:202')).excluded,false);assert.deepEqual((await get(f,'reservation:'+rid+':202')).slots,[]);
});
ft('concurrent admin starts and duplicate finishes retain idempotency',async f=>{
 const replies=await Promise.all([f.start(101,'parallel-admin-a'),f.start(101,'parallel-admin-b')]);assert.equal(replies[0].attempt.id,replies[1].attempt.id);
 const a=replies[0].attempt,first=await finish(f,a,101,1),head=await f.store.head();
 const second=await f.service.finish({attemptId:a.id,...f.payload(4)},ctx(101));assert.deepEqual(first.attempt,second.attempt);assert.deepEqual(await f.store.head(),head);
 const s=await f.service.adminRead({includeAdminTests:true},ctx(202));assert.equal(s.players[0].testAttemptCount,1);assert.equal(s.players[0].totalAttemptCount,0);
});
ft('admin tests do not change existing ordinary-player statistics or leaderboard',async f=>{
 await f.command('activate');await finish(f,(await f.start(303,'ordinary-baseline')).attempt,303,1);
 const before=await f.service.adminRead({releaseId:rid},ctx(101));
 for(const uid of [101,202])for(let i=0;i<3;i++)await finish(f,(await f.start(uid,`compare-${uid}-${i}`)).attempt,uid,i);
 const after=await f.service.adminRead({releaseId:rid},ctx(101));assert.deepEqual(after.stats,before.stats);assert.deepEqual(after.rankings,before.rankings);assert.deepEqual(after.attempts,before.attempts);assert.deepEqual(after.players,before.players);
});
ft('include-tests filter cannot contaminate aggregate counts',async f=>{
 await f.command('activate');await finish(f,(await f.start(101,'include-admin')).attempt,101);await finish(f,(await f.start(303,'include-player')).attempt,303);
 const ordinary=await f.service.adminRead({releaseId:rid},ctx(202));const all=await f.service.adminRead({releaseId:rid,includeAdminTests:true},ctx(202));
 assert.equal(ordinary.players.length,1);assert.equal(all.players.length,2);assert.deepEqual(all.stats,ordinary.stats);assert.deepEqual(all.rankings,ordinary.rankings);assert.deepEqual(all.attempts,ordinary.attempts);
 for(const value of ['true',1,'1'])assert.equal((await f.service.adminRead({includeAdminTests:value},ctx(202))).players.length,1);
});
ft('test history remains inspectable without changing source records',async f=>{
 const a=(await f.start(101,'history-start')).attempt;await f.service.abandon({attemptId:a.id},ctx(101));const before=await records(f);
 const data=await f.service.adminRead({includeAdminTests:true,userId:101},ctx(202));assert.equal(data.playerAttempts[0].status,'unfinished');assert.equal(data.players[0].testAttemptCount,1);assert.equal(data.players[0].attemptCount,0);assert.equal(data.players[0].excluded,false);assert.deepEqual(await records(f),before);
});
ft('current allowlist filters old non-preview admin records without rewriting them',async f=>{
 await f.command('activate');await finish(f,(await f.start(303,'future-admin')).attempt,303);
 const before=await records(f),s=serviceFor(f,[303,202]),a=await s.adminRead({releaseId:rid},ctx(202));
 assert.equal(a.stats.attempts,0);assert.equal(a.stats.participants,0);assert.deepEqual(a.rankings,[]);assert.deepEqual(a.players,[]);assert.deepEqual(a.attempts,[]);
 const history=await s.adminRead({includeAdminTests:true,userId:303},ctx(202));assert.equal(history.players[0].totalAttemptCount,0);assert.equal(history.players[0].testAttemptCount,1);assert.equal(history.playerAttempts[0].mode,'contest');assert.deepEqual(await records(f),before);
});
ft('promoted admin ignores pre-existing two-slot quota',async f=>{
 await f.command('activate');for(let i=0;i<2;i++)await finish(f,(await f.start(303,'before-admin-'+i)).attempt,303);
 const original=await get(f,'reservation:'+rid+':303'),s=serviceFor(f,[303,202]);
 for(let i=0;i<4;i++){const a=(await s.start({releaseId:rid,requestId:'promoted-'+i},ctx(303))).attempt;assert.equal(a.mode,'preview');assert.equal(a.slot,null);await s.abandon({attemptId:a.id},ctx(303));}
 assert.deepEqual((await get(f,'reservation:'+rid+':303')).slots,original.slots);
 assert.equal((await s.lobby({releaseId:rid},ctx(303))).remaining,null);
});
ft('finishing an old competitive attempt after promotion never enters current standings',async f=>{
 await f.command('activate');const a=(await f.start(303,'promoted-active')).attempt,s=serviceFor(f,[303,202]);f.advance(5000);
 const r=await s.finish({attemptId:a.id,...f.payload()},ctx(303));assert.equal(r.attempt.eligible,false);assert.equal(r.saved,true);assert.deepEqual(r.rankings,[]);assert.equal(r.remaining,null);
});
ft('removing admin role never upgrades stored previews into competitive attempts',async f=>{
 await f.command('activate');await finish(f,(await f.start(101,'former-admin')).attempt,101);
 const s=serviceFor(f,[202,404]),r=await s.adminRead({releaseId:rid},ctx(202));assert.equal(r.stats.attempts,0);assert.deepEqual(r.rankings,[]);assert.equal(r.players.find(p=>p.userId===101).totalAttemptCount,0);
 const a=(await s.start({releaseId:rid,requestId:'former-now-player'},ctx(101))).attempt;assert.equal(a.mode,'contest');assert.equal(a.slot,1);
});
ft('existing official final is byte-for-byte unchanged when its winner becomes admin',async f=>{
 await f.command('activate');await finish(f,(await f.start(303,'final-winner')).attempt,303);await f.command('close');await f.command('finalize');
 const before=JSON.stringify(await get(f,'final:'+rid)),s=serviceFor(f,[303,202]);const r=await s.adminRead({releaseId:rid},ctx(202));
 assert.equal(r.final.stats.participants,1);assert.equal(r.final.rankings[0].userId,303);assert.equal(r.rankings[0].userId,303);
 assert.equal((await s.leaderboard({releaseId:rid},ctx(505))).rows.length,1);assert.equal(JSON.stringify(await get(f,'final:'+rid)),before);
});
ft('future finalization ignores legacy admin results and their pending-review flags',async f=>{
 await f.command('activate');const a=(await f.start(303,'pending-future-admin')).attempt;f.advance(5000);await f.service.finish({attemptId:a.id,...f.payload(),actions:[]},ctx(303));
 await finish(f,(await f.start(404,'legitimate-final')).attempt,404);await f.command('close');const s=serviceFor(f,[303,202]);
 await s.adminCommand({command:'finalize',releaseId:rid,expectedRevision:(await f.store.head()).revision},ctx(202));
 const final=await get(f,'final:'+rid);assert.equal(final.stats.participants,1);assert.deepEqual(final.rankings.map(x=>x.userId),[404]);
});
ft('admin observations add no player acquisition events; old observations excluded non-destructively',async f=>{
 const head=await f.store.head();for(const uid of [101,202])await f.service.observe(ctx(uid),{allowed:true,releaseId:rid});assert.deepEqual(await f.store.head(),head);
 await put(f,[{key:'visit:legacy-admin',kind:'visit',data:{userId:101,source:'set_link',releaseId:rid,firstDeniedAt:f.now(),firstAllowedAt:f.now()}}]);
 await f.service.observe(ctx(303,'set_classic-1'),{allowed:false,releaseId:rid});await f.service.observe(ctx(303,'set_classic-1'),{allowed:true,releaseId:rid});
 const before=await records(f),state=await f.service.adminRead({},ctx(101));assert.deepEqual(state.visits,{sessions:1,fromSetLink:1,observedSubscriptionTransitions:1});assert.deepEqual(await records(f),before);assert.ok(await get(f,'visit:legacy-admin'));
});
ft('ordinary zero-attempt visitor is still visible',async f=>{
 await f.service.observe(ctx(505),{allowed:true});const state=await f.service.adminRead({},ctx(101));assert.equal(state.players[0].userId,505);assert.equal(state.players[0].totalAttemptCount,0);assert.equal(state.players[0].isAdmin,false);
});
ft('test history and old visit records remain in existing backup format',async f=>{
 await finish(f,(await f.start(101,'backup-admin-test')).attempt,101);await f.start(303,'backup-normal');
 const b=await f.backup.export({},ctx(202));const parsed=parseBackup(b,{availableGames:games});assert.equal(parsed.counts.attempt,2);
 assert.ok(b.records.some(r=>r.kind==='attempt'&&r.data.mode==='preview'));assert.ok(b.records.some(r=>r.kind==='player'&&r.data.userId===101));
});
ft('non-admin cannot enable private test-history filter or read records',async f=>{
 const before=await f.store.head();await assert.rejects(f.service.adminRead({includeAdminTests:true,userId:101,isAdmin:true},ctx(303)),e=>e.code==='FORBIDDEN');assert.deepEqual(await f.store.head(),before);
});
ft('malformed server allowlist fails closed and never grants an unlimited role',async f=>{
 await f.command('activate');const s=serviceFor(f,[303]);await assert.rejects(s.adminRead({},ctx(303)),e=>e.code==='FORBIDDEN');
 const a=(await s.start({releaseId:rid,requestId:'malformed-allowlist'},ctx(303))).attempt;assert.equal(a.mode,'contest');assert.equal((await s.lobby({releaseId:rid},ctx(303))).remaining,1);
});
