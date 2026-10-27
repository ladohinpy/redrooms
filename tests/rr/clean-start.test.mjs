/** Clean player entrance. Local fixtures only; no Telegram token or network. */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import crypto from 'node:crypto';
import {renderPlayerIntro} from '../../src/rr/contest-client.mjs';
import {createService} from '../../src/rr/service.mjs';
import {seed,ctx,memoryRepository} from './helpers.mjs';
const file=p=>fs.readFileSync(new URL('../../'+p,import.meta.url),'utf8');
const built=JSON.parse(file('config/rr-built-games.json')).games;
const clean=built.find(g=>g.id==='v10-clean-start');
class Element {
 constructor(tag,text=''){this.tag=tag;this.textContent=text;this.children=[];this.hidden=false;}
 append(...n){this.children.push(...n);}
 replaceChildren(...n){this.children=n;this.textContent='';}
 setAttribute(k,v){this[k]=v;}
 addEventListener(){}
 get visibleText(){return this.hidden?'':this.textContent+this.children.map(n=>n.visibleText).join('');}
}
function dom(){globalThis.Node=Element;globalThis.document={createElement:t=>new Element(t),createTextNode:t=>new Element('#text',String(t))};return new Element('div');}
for(const block of [undefined,null,{}, {title:'',text:'',url:''}, {title:'  ',text:'\n\t'}, {linkLabel:'unused'}, {name:'тест1',mode:'preview'}]){
 test('clean start: empty or unrelated editorial fields produce no fallback '+JSON.stringify(block),()=>{const box=dom();renderPlayerIntro(box,block);assert.equal(box.hidden,true);assert.equal(box.children.length,0);assert.equal(box.visibleText,'');});
}
test('clean start: explicit intro renders with formatting and no inferred release/mode/buttons',()=>{const box=dom();renderPlayerIntro(box,{title:'Кино семидесятых',text:'Текст Виталия. **Удачи!**\nВторая строка.'});assert.equal(box.hidden,false);assert.match(box.visibleText,/Кино семидесятыхТекст Виталия. Удачи!Вторая строка/);assert.equal(box.children[0].children[0].tag,'h3');assert.doesNotMatch(box.visibleText,/тест1|Тестовый режим|Свободное прохождение|Поделиться|рейтинг/);});
test('clean start: authored text remains text, not executable markup',()=>{const box=dom();renderPlayerIntro(box,{text:'<img src=x onerror=alert(1)>'});assert.equal(box.visibleText,'<img src=x onerror=alert(1)>');const walk=n=>[n.tag,...n.children.flatMap(walk)];assert.ok(!walk(box).includes('img'));});
test('clean start: explicit link works; repeated rendering replaces old copy and removes emptied content',()=>{const box=dom();renderPlayerIntro(box,{text:'Первый',url:'https://t.me/vitalkino_stage_bot',linkLabel:'О выпуске'});assert.equal(box.children[0].children.at(-1).href,'https://t.me/vitalkino_stage_bot');renderPlayerIntro(box,{text:'Второй'});assert.equal(box.visibleText,'Второй');assert.equal(box.children.length,1);renderPlayerIntro(box,{});assert.equal(box.hidden,true);assert.equal(box.children.length,0);});
test('clean start: new HTML has a blank inline author slot and one independent cassette count',()=>{const html=file('src/rr-game-v10.html');const start=html.slice(html.indexOf('<section id="start"'),html.indexOf('<section id="pause"'));assert.match(start,/<h1>Красная<br> комната<\/h1>/);assert.match(start,/id="rr-player-intro" class="lede" hidden/);assert.equal((start.match(/id="collectionSize"/g)||[]).length,1);assert.doesNotMatch(start,/Разложите кассеты по подходящим столам|rr-contest-intro|Тестовый режим|Поделиться|Посмотреть рейтинг/);});
for(const id of ['v06','v07-tables','v08-player-ui','v09-contests'])test('clean start: '+id+' gets compatible renderer without rewriting logical IDs or catalog',async()=>{
 const g=built.find(g=>g.id===id),repo=memoryRepository();const s=createService({repository:repo,adminIds:[101,202],games:[g,clean],seed,checkSubscription:async()=>({allowed:true})});const before=await s.read({},ctx(101));const out=await s.launch({},ctx(303));assert.equal(out.runtime.id,'v10-clean-start');assert.equal(out.game.id,id);assert.equal(out.release.id,'classic-1');assert.equal(out.release.gameVersionId,id);assert.equal(out.catalog.id,seed.id);assert.deepEqual(await s.read({},ctx(101)),before);
});
test('clean start: an unrecognized custom v09 hash is not upgraded to the hotfix renderer',async()=>{const g={...built.find(g=>g.id==='v09-contests'),codeHash:'b'.repeat(64),entry:'/games/v09-contests/'+ 'b'.repeat(16)+'/index.html'};const s=createService({repository:memoryRepository(),adminIds:[101,202],games:[g,clean],seed,checkSubscription:async()=>({allowed:true})});const out=await s.launch({},ctx(303));assert.equal(out.runtime.codeHash,g.codeHash);assert.notEqual(out.runtime.id,clean.id);});
test('clean start: original four frozen builds and source files retain their declared hashes',()=>{for(const g of built.filter(g=>g.id!==clean.id)){const hash=x=>crypto.createHash('sha256').update(x).digest('hex');assert.equal(hash(file('public'+g.entry)),g.codeHash);assert.equal(hash(file(g.source)),g.sourceHash);for(const a of g.runtimeAssets)assert.equal(hash(file('public/'+a.path)),a.hash);}});
test('clean start: wrong-table feedback is neutral and scoring and action recording stay unchanged',()=>{
 const html=file('src/rr-game-v10.html'),part=html.slice(html.indexOf('function putTapeOnShelf('),html.indexOf('function flashShelf('));let toast='',recorded=[];const tape={userData:{film:{id:'film-a',director:'year-2026'}}};
 const c=vm.createContext({heldTape:tape,shelfGroups:[{userData:{director:'year-2027'}}],window:{RRContest:{record:(...args)=>recorded.push(args)}},attempts:1,correctCount:1,beep(){},hapticNotice(){},flashShelf(){},showToast:t=>toast=t,updateHUD(){},saveProgress(){},pauseGame(){}});
 vm.runInContext(part+"\nputTapeOnShelf('year-2027');",c);assert.equal(toast,'Неправильно. Точность снижена.');assert.equal(c.attempts,2);assert.equal(c.correctCount,1);assert.equal(c.heldTape,tape);assert.deepEqual(recorded,[['film-a','year-2027']]);
 const original=file('src/rr-game-v09.html');for(const name of ['scoreFor','accuracyFor']){const re=new RegExp('const '+name+' =[^\\n]+');assert.equal(html.match(re)[0],original.match(re)[0]);}
});
test('clean start: entry is not a competition dashboard, recovery remains and final sharing remains',()=>{const s=file('src/rr/contest-client.mjs');const attach=s.slice(s.indexOf(' function attach(){'),s.indexOf(' async function ensureStart()'));assert.match(attach,/renderPlayerIntro/);assert.doesNotMatch(attach,/linkActions|rankings|summary\(/);assert.match(s,/rr-attempt-recovery/);const finish=s.slice(s.indexOf(' function renderFinish('),s.indexOf(' async function finish('));assert.match(finish,/linkActions/);assert.match(finish,/Таблица результатов/);});
test('clean start: management navigation is restricted to the paused admin screen, no release-name badge',()=>{const s=file('src/rr/engine-boot.mjs');assert.match(s,/if \(data.isAdmin === true\)/);assert.match(s,/getElementById\('pause'\)/);assert.match(s,/pauseCard.append\(tools\)/);assert.doesNotMatch(s,/button\(data.release.name|document.body.append\(tools\)/);});
