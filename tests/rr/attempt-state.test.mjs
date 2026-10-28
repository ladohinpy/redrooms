/** Real server logic + real SQLite + original client controller in a VM.
 * Only DOM, Telegram identities, transport and browser storage are adapters.
 * No network, deployment or production database calls. */
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
import {fixture,ctx,games,seed} from './package1-helpers.mjs';
import {createService} from '../../src/rr/service.mjs';
import {memoryRepository} from './helpers.mjs';
import {parseBackup} from '../../src/rr/backup.mjs';
const read=p=>fs.readFileSync(new URL('../../'+p,import.meta.url),'utf8');
const json=v=>JSON.parse(JSON.stringify(v));
const ledgerKey=(uid=101,rid='classic-1')=>`rr:contest:1:${uid}:${rid}`;
const stale=(a,req,extra={})=>({version:1,releaseId:a.releaseId||'classic-1',requestId:req,attemptId:a.id,mode:a.mode,startedAt:a.startedAt,actions:[],pending:null,receipt:null,...extra});
async function client(f,{uid=101,storage={},override,source=read('src/rr/contest-client.mjs')}={}){
 const saved={...storage},calls=[],nav=[];let seq=0;
 const sandbox=vm.createContext({window:{RR_SAVE_PREFIX:'test:'},document:{getElementById:()=>null},location:{pathname:'/game'},navigator:{onLine:true},console,URLSearchParams,Date,Math,
 localStorage:{getItem:k=>saved[k]??null,setItem:(k,v)=>saved[k]=String(v),removeItem:k=>delete saved[k]},
 setInterval:()=>0,clearInterval:()=>{},addEventListener:()=>{},confirm:()=>true,
 crypto:{randomUUID:()=>`new-request-${uid}-${++seq}-${Math.random().toString(36).slice(2)}`},
 navigate:(...x)=>nav.push(x),
 call:async(name,input)=>{calls.push(json({name,input}));const go=()=>f.service[input.action](input,ctx(uid));return override?override(name,input,go):go();}});
 vm.runInContext(source.replace(/^import .*;\n/gm,'').replace(/export /g,'')+'\nglobalThis.makeClient=createContestClient;',sandbox);
 const c=await sandbox.makeClient({userId:uid,release:{id:'classic-1'}});
 return {c,saved,calls,nav,window:sandbox.window,ledger:()=>JSON.parse(saved[ledgerKey(uid)]||'null')};
}
const rows=async f=>(await f.store.view(await f.store.head()).list('attempt')).map(x=>x.data);
async function scenario(fn){const f=await fixture();try{return await fn(f);}finally{f.close();}}
for(const uid of [101,202,303])test('attempt state: first start still works for '+uid,()=>scenario(async f=>{const x=await client(f,{uid});assert.equal(await x.c.ensureStart(),true);assert.equal(x.c.running,true);assert.equal((await rows(f)).length,1);assert.equal(x.ledger().mode,uid===303?'practice':'preview');}));
test('attempt state: reproduce old false-completed loop and zero-preview counter',()=>scenario(async f=>{
 const req='original-request-1',a=(await f.start(101,req)).attempt;await f.service.abandon({attemptId:a.id},ctx(101));
 const original=read('tests/rr/fixtures/contest-client-before-attempt-state.txt');const storage={[ledgerKey()]:JSON.stringify(stale(a,req))};
 for(let i=0;i<3;i++){const x=await client(f,{storage,source:original});await assert.rejects(x.c.ensureStart(),/Эта попытка уже завершена/);}
 const state=await f.service.adminRead({userId:101,includeAdminTests:true},ctx(202));assert.equal(state.players[0].attemptCount,0);assert.equal(state.playerAttempts[0].status,'unfinished');assert.equal(state.playerAttempts[0].mode,'preview');assert.equal(state.playerAttempts.length,1);
}));
test('attempt state: closed admin preview becomes new preview only on explicit start, old row unchanged',()=>scenario(async f=>{
 const req='closed-admin-1',a=(await f.start(101,req)).attempt;await f.service.abandon({attemptId:a.id},ctx(101));const old=json((await rows(f))[0]);
 const x=await client(f,{storage:{[ledgerKey()]:JSON.stringify(stale(a,req))}});
 assert.equal((await rows(f)).length,1);assert.equal(x.window.RR_SAVE_PREFIX,'test:unstarted:');assert.equal(await x.c.ensureStart(),true);assert.notEqual(x.ledger().attemptId,a.id);assert.notEqual(x.ledger().requestId,req);
 assert.deepEqual((await rows(f)).find(r=>r.id===a.id),old);assert.equal((await rows(f)).length,2);assert.ok(x.saved[ledgerKey()+':previous-closed']);
}));
test('attempt state: lost completed receipt restored from server without creating or rewriting result',()=>scenario(async f=>{
 const req='completed-stale-1',a=(await f.start(101,req)).attempt;await f.service.finish({attemptId:a.id,...f.payload(1)},ctx(101));const before=json(await rows(f));
 const x=await client(f,{storage:{[ledgerKey()]:JSON.stringify(stale(a,req))}});
 assert.equal(x.ledger().receipt.attempt.status,'completed');assert.equal(x.ledger().receipt.attempt.result.score,before[0].calculated.score);assert.deepEqual(await rows(f),before);
}));
test('attempt state: terminal response to unconfirmed request reloads once, next start uses fresh ID',()=>scenario(async f=>{
 const req='no-local-id-01',a=(await f.start(101,req)).attempt;await f.service.abandon({attemptId:a.id},ctx(101));
 const x=await client(f,{storage:{[ledgerKey()]:JSON.stringify(stale(a,req,{attemptId:null}))}});
 assert.equal(await x.c.ensureStart(),false);assert.equal(x.nav.length,1);assert.equal(x.c.running,false);assert.equal(x.ledger().attemptId,a.id);assert.equal((await rows(f)).length,1);
 const next=await client(f,{storage:x.saved});assert.equal(await next.c.ensureStart(),true);assert.notEqual(next.ledger().attemptId,a.id);assert.equal(next.nav.length,0);
}));
test('attempt state: closing in another tab does not start the room with stale cassette positions',()=>scenario(async f=>{
 const req='other-tab-0001',a=(await f.start(303,req)).attempt;
 const x=await client(f,{uid:303,storage:{[ledgerKey(303)]:JSON.stringify(stale(a,req))}});
 await f.service.abandon({attemptId:a.id},ctx(303));assert.equal(await x.c.ensureStart(),false);assert.equal(x.c.running,false);assert.equal(x.nav.length,1);assert.equal((await rows(f)).length,1);
}));
test('attempt state: two exhausted competitive slots stay exhausted after stale local ledger and retries',()=>scenario(async f=>{
 await f.command('activate');let first;
 for(let i=0;i<2;i++){const a=(await f.start(303,'competitive-000'+i)).attempt;first??=a;await f.service.abandon({attemptId:a.id},ctx(303));}
 const before=json(await rows(f)),storage={[ledgerKey(303)]:JSON.stringify(stale(first,'competitive-0000'))};
 for(let i=0;i<3;i++){const x=await client(f,{uid:303,storage});await assert.rejects(x.c.ensureStart(),e=>e.code==='ATTEMPTS_EXHAUSTED');}
 assert.deepEqual(await rows(f),before);
}));
test('attempt state: archived games remain playable after two used contest slots',()=>scenario(async f=>{
 await f.command('activate');let a;
 for(let i=0;i<2;i++){a=(await f.start(303,'archive-used-00'+i)).attempt;await f.service.abandon({attemptId:a.id},ctx(303));}
 await f.command('close');const x=await client(f,{uid:303,storage:{[ledgerKey(303)]:JSON.stringify(stale(a,'archive-used-001'))}});
 assert.equal(await x.c.ensureStart(),true);assert.equal(x.ledger().mode,'archive');assert.equal((await rows(f)).filter(a=>a.mode==='contest').length,2);
}));
test('attempt state: pending result survives failed entry and receives idempotent confirmation',()=>scenario(async f=>{
 const req='pending-result-1',a=(await f.start(303,req)).attempt,pending={attemptId:a.id,...f.payload()};await f.service.finish(pending,ctx(303));
 const x=await client(f,{uid:303,storage:{[ledgerKey(303)]:JSON.stringify(stale(a,req,{pending}))}});
 await assert.rejects(x.c.ensureStart(),/Сначала отправьте/);assert.deepEqual(x.ledger().pending,pending);assert.equal((await rows(f)).length,1);
 await x.c.finish(null);assert.equal(x.ledger().pending,null);assert.equal(x.ledger().receipt.saved,true);assert.equal((await rows(f)).length,1);
}));
test('attempt state: lost start ACK and page reopen recover the SAME server attempt',()=>scenario(async f=>{
 let lost=true;const x=await client(f,{uid:303,override:async(n,i,go)=>{const r=await go();if(i.action==='start'&&lost){lost=false;throw Object.assign(Error('lost'),{code:'TIMEOUT'});}return r;}});
 await assert.rejects(x.c.ensureStart(),e=>e.code==='TIMEOUT');const req=x.ledger().requestId;assert.equal(x.ledger().attemptId,null);assert.equal((await rows(f)).length,1);
 const y=await client(f,{uid:303,storage:x.saved});assert.equal(await y.c.ensureStart(),true);assert.equal(y.ledger().requestId,req);assert.equal((await rows(f)).length,1);
}));
for(const status of [undefined,'unexpected',false])test('attempt state: invalid start status is NOT labelled completed '+String(status),()=>scenario(async f=>{
 let bad=true;const x=await client(f,{override:async(n,i,go)=>{const r=await go();if(i.action==='start'&&bad){bad=false;return {...r,attempt:{...r.attempt,status}};}return r;}});
 await assert.rejects(x.c.ensureStart(),e=>e.code==='ATTEMPT_RESPONSE_INVALID'&&!/завершена/.test(e.message));const req=x.ledger().requestId;assert.equal(x.c.running,false);assert.equal((await rows(f)).length,1);
 assert.equal(await x.c.ensureStart(),true);assert.equal(x.ledger().requestId,req);assert.equal((await rows(f)).length,1);
}));
test('attempt state: random request cannot turn missing progress into a fresh or replayable attempt',()=>scenario(async f=>{
 await f.command('activate');const a=(await f.start(303,'first-device-1')).attempt;
 const x=await client(f,{uid:303,storage:{[ledgerKey(303)]:JSON.stringify(stale(a,'second-device-1',{attemptId:null}))}});
 for(let i=0;i<2;i++)await assert.rejects(x.c.ensureStart(),/Прогресс начатой попытки не найден/);
 const alias=await f.service.start({releaseId:'classic-1',requestId:'second-device-1'},ctx(303));assert.equal(alias.createdByRequest,false);assert.equal((await rows(f)).length,1);assert.equal(x.ledger().attemptId,null);
}));
test('attempt state: missing active local game save is not healed by resetting the quota',()=>scenario(async f=>{
 await f.command('activate');const a=(await f.start(303,'missing-save-1')).attempt;const ledger=stale(a,'missing-save-1',{gameKey:'missing-file',actions:[{seq:1,filmId:'f',tableId:'t'}]});const x=await client(f,{uid:303,storage:{[ledgerKey(303)]:JSON.stringify(ledger)}});
 await assert.rejects(x.c.ensureStart(),/Игровое сохранение потеряно/);assert.equal((await rows(f)).length,1);assert.deepEqual(x.ledger(),ledger);
}));
test('attempt state: moderator void replacement retains old attempt and does not affect another player',()=>scenario(async f=>{
 await f.command('activate');const a=(await f.start(303,'void-me-0001')).attempt,other=(await f.start(404,'other-player-1')).attempt;
 await f.command('voidAttempt',{attemptId:a.id,reason:'Technical test'});const x=await client(f,{uid:303,storage:{[ledgerKey(303)]:JSON.stringify(stale(a,'void-me-0001'))}});
 assert.equal(await x.c.ensureStart(),true);const all=await rows(f);assert.equal(all.find(x=>x.id===a.id).voided,true);assert.equal(all.find(x=>x.id===other.id).status,'started');assert.equal(all.filter(a=>a.userId===303&&!a.voided).length,1);
}));
test('attempt state: player counters show actual records and separate preview without leaderboard pollution',()=>scenario(async f=>{
 await f.service.observe(ctx(505),{allowed:true});const a=(await f.start(101,'counter-admin-1')).attempt;await f.service.abandon({attemptId:a.id},ctx(101));await f.start(101,'counter-admin-2');const p=(await f.start(303,'counter-player-1')).attempt;await f.service.finish({attemptId:p.id,...f.payload()},ctx(303));
 const r=await f.service.adminRead({includeAdminTests:true},ctx(202));const admin=r.players.find(p=>p.userId===101),player=r.players.find(p=>p.userId===303),visitor=r.players.find(p=>p.userId===505);
 assert.equal(admin.attemptCount,0);assert.equal(admin.totalAttemptCount,0);assert.equal(admin.testAttemptCount,2);assert.equal(admin.previewCount,2);assert.equal(admin.activeAttemptCount,0);assert.equal(admin.unfinishedAttemptCount,0);assert.equal(admin.totalSetCount,0);
 assert.equal(player.attemptCount,1);assert.equal(player.totalAttemptCount,1);assert.equal(player.previewCount,0);assert.equal(visitor.totalAttemptCount,0);assert.equal((await f.service.leaderboard({releaseId:'classic-1'},ctx(303))).rows.length,0);
}));
test('attempt state: older request records without created metadata remain resumable with exact attempt ID',()=>scenario(async f=>{
 const req='legacy-request-1',a=(await f.start(303,req)).attempt;
 await f.store.transact(async()=>({changes:[{key:'start:303:'+req,kind:'request',data:{attemptId:a.id,releaseId:'classic-1'}}],value:true}));
 const x=await client(f,{uid:303,storage:{[ledgerKey(303)]:JSON.stringify(stale(a,req))}});assert.equal(await x.c.ensureStart(),true);assert.equal(x.ledger().attemptId,a.id);assert.equal((await rows(f)).length,1);
}));
test('attempt state: backup still validates the new optional request metadata and frozen final',()=>scenario(async f=>{
 await f.command('activate');const a=(await f.start(303,'backup-check-1')).attempt;await f.service.finish({attemptId:a.id,...f.payload()},ctx(303));await f.command('close');await f.command('finalize',{acknowledgePending:true});
 const b=await f.backup.export({},ctx(101));const result=parseBackup(b,{availableGames:games,currentRecords:await f.store.view(await f.store.head()).list()});assert.equal(result.counts.attempt,1);assert.equal(result.counts.final,1);
}));
test('attempt state: invalid request pointer fails closed instead of serializing a fake attempt',()=>scenario(async f=>{
 const a=(await f.start(303,'valid-pointer-1')).attempt;await f.store.transact(async()=>({changes:[{key:'start:101:broken-link-01',kind:'request',data:{attemptId:a.id,releaseId:'classic-1'}}],value:true}));
 await assert.rejects(f.start(101,'broken-link-01'),e=>e.code==='ATTEMPT_STATE_INVALID');assert.equal((await rows(f)).length,1);
}));
test('attempt state: latest renderer preserves all known logical release IDs, catalogs and save identity',async()=>{
 const built=JSON.parse(read('config/rr-built-games.json')).games,fix=built.find(g=>g.id==='v12-attempt-state');assert.ok(fix);
 for(const old of built.filter(g=>g.id!==fix.id)){
  const repo=memoryRepository(),s=createService({repository:repo,adminIds:[101,202],games:[old,fix],seed,checkSubscription:async()=>({allowed:true})});const before=await s.read({},ctx(101));const r=await s.launch({},ctx(303));assert.equal(r.runtime.id,fix.id);assert.equal(r.game.id,old.id);assert.deepEqual(await s.read({},ctx(101)),before);
 }
});
test('attempt state: false entry result cannot hide menus or start the world',()=>{const s=read('src/rr-game-v12.html');assert.match(s,/if \(await window.RRContest.ensureStart\(\) !== true\) \{ UI.startButton.disabled=false; return; \}/);});
