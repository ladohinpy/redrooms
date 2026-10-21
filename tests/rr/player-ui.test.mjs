/** Regression contract for player-only UI; no production credentials or network. */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import {fileURLToPath} from 'node:url';
import {launchFailure,playerMessage,adminRequested} from '../../src/rr/client.mjs';
import {createService} from '../../src/rr/service.mjs';
import {seed,games,ctx,memoryRepository} from './helpers.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const text=p=>fs.readFileSync(path.join(root,p),'utf8');
const forbidden=/TABLES ADMIN|tables-admin|Telegram ID|SUBSCRIPTION_REQUIRED|TIMEOUT|Этап:|диагностик|управлен|разрешённых аккаунт|нет доступа/i;
class Element {
 constructor(tag){this.tag=tag;this.children=[];this.classList={toggle(){}};}
 append(...parts){this.children.push(...parts);}
 replaceChildren(...parts){this.children=parts;}
 addEventListener(name,fn){this['on'+name]=fn;}
 setAttribute(k,v){this[k]=v;}
 get visibleText(){return (this.textContent||'')+this.children.map(n=>n.visibleText||n.text||'').join(' ');}
}
function render(error){globalThis.Node=Element;globalThis.document={createElement:t=>new Element(t),createTextNode:t=>({text:t})};const box=new Element('div');launchFailure(box,error,()=>{});return box;}
const e=(code,message='RAW: database rr_admin_state, secret=DO_NOT_RENDER')=>({code,message,parameters:{joinUrl:'https://t.me/redrooms_stage'}});
test('player subscription screen has named channel, exactly two buttons, no administrative controls',()=>{const box=render(e('SUBSCRIPTION_REQUIRED'));assert.equal(box.children.filter(x=>x.tag==='button').length,2);assert.match(box.visibleText,/Витальное кино/);assert.match(box.visibleText,/Проверить снова/);assert.doesNotMatch(box.visibleText,forbidden);assert.doesNotMatch(box.visibleText,/RAW|rr_admin_state|DO_NOT_RENDER/);});
for(const code of ['TIMEOUT','CHECK_UNAVAILABLE','INTERNAL_ERROR','FORBIDDEN','NOT_FOUND','NAVIGATION_LOOP','NAVIGATION_BLOCKED','AUTH_REQUIRED',undefined])test('player error copy never echoes backend details: '+code,()=>{const box=render(e(code));assert.doesNotMatch(box.visibleText,forbidden);assert.doesNotMatch(box.visibleText,/RAW|rr_admin_state|DO_NOT_RENDER/);assert.equal(box.children.filter(x=>x.tag==='button').length,1);});
for(const url of ['javascript:alert(1)','https://evil.test','https://t.me/okay?token=secret','//evil.test','https://t.me/okay/../else'])test('untrusted join URL is not a public link: '+url,()=>{const box=render({code:'SUBSCRIPTION_REQUIRED',parameters:{joinUrl:url}});assert.equal(box.children.filter(x=>x.tag==='button').length,1);});
test('public retry does not navigate to management',()=>{let calls=0;globalThis.Node=Element;globalThis.document={createElement:t=>new Element(t),createTextNode:t=>({text:t})};const box=new Element('div');launchFailure(box,e('SUBSCRIPTION_REQUIRED'),()=>calls++);box.children.at(-1).onclick();assert.equal(calls,1);assert.doesNotMatch(box.visibleText,/управлен/i);});
for(const name of ['admin','admin-advanced'])test(name+' initial HTML is neutral even before JS and on script failure',()=>{const html=text('src/rr/'+name+'.html');assert.match(html,/<title>Красная комната<\/title>/);assert.match(html,/id="identity" hidden/);assert.doesNotMatch(html,/Telegram ID|нет доступа|TABLES ADMIN|ADMIN_MODULE_LOAD|права администратора|<h1>Наборы/);});
test('launcher HTML has no management link, version banner or debug fallback',()=>{const html=text('src/rr/launcher.html');assert.doesNotMatch(html,/admin-direct|href="\/admin|TABLES ADMIN|MODULE_LOAD|Скопировать диагностику|Открыть управление/);});
test('default launch overrides retained unsigned admin hint',()=>{globalThis.location={search:'?rr_default=1&tgWebAppStartParam=admin&admin=1'};assert.equal(adminRequested(),false);globalThis.location={search:'?startapp=admin'};assert.equal(adminRequested(),true);});
const setup=(access=true,repo=memoryRepository())=>createService({repository:repo,adminIds:[101,202],games,seed,checkSubscription:async()=>({allowed:access,joinUrl:'https://t.me/redrooms_stage'})});
test('outsider admin deep-link is ordinary subscribed game, not an admin refusal page',async()=>{const data=await setup().launch({},ctx(303,'admin'));assert.equal(data.admin,undefined);assert.equal(data.isAdmin,false);assert.equal(data.release.id,'classic-1');});
test('outsider admin deep-link still requires subscription',async()=>{await assert.rejects(()=>setup(false).launch({},ctx(404,'admin')),e=>e.code==='SUBSCRIPTION_REQUIRED');});
for(const uid of [101,202])test('actual allowed admin retains private direct entry: '+uid,async()=>{assert.deepEqual(await setup(false).launch({},ctx(uid,'admin')),{admin:true,isAdmin:true,userId:uid});});
test('private data are not read on denied administrative request',async()=>{let reads=0;const service=setup(true,{read(){reads++;throw Error('must not run');}});await assert.rejects(()=>service.read({userId:101,isAdmin:true},ctx(303)),e=>e.code==='FORBIDDEN');assert.equal(reads,0);});
// Use the real service with the shipped hashes, including the compatible renderer.
const built=JSON.parse(text('config/rr-built-games.json')).games;
for(const logical of ['v06','v07-tables'])test('public UI runtime preserves release/game identity for '+logical,async()=>{
 const selected=built.find(g=>g.id===logical),target=built.find(g=>g.id==='v08-player-ui');assert.ok(target);
 const service=createService({repository:memoryRepository(),adminIds:[101,202],games:[selected,target],seed,checkSubscription:async()=>({allowed:true})});
 const data=await service.launch({},ctx(303));assert.equal(data.game.id,logical);assert.equal(data.runtime.id,'v08-player-ui');assert.equal(data.release.gameVersionId,logical);assert.equal(data.catalog.id,seed.id);
});
test('runtime repair never swaps an unknown user build',async()=>{const target=built.find(g=>g.id==='v08-player-ui');const service=createService({repository:memoryRepository(),adminIds:[101,202],games:[games[0],target],seed,checkSubscription:async()=>({allowed:true})});const data=await service.launch({},ctx(303));assert.equal(data.runtime.id,'v06');});
test('public source and prepared assets match; next preparation cannot restore debug widgets',()=>{for(const n of ['client','launcher','admin','admin-advanced'])assert.equal(text('src/rr/'+n+'.mjs'),text('public/rr/'+n+'.mjs'));assert.equal(text('src/rr/launcher.html'),text('public/index.html'));});
