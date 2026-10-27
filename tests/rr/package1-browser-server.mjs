/** LOCAL ONLY: real services + SQLite + real bundled game; synthetic Telegram identity transport.
 * This file and its test-only game hooks are NEVER placed in public/ or deployed. */
import http from 'node:http';import fs from 'node:fs';import path from 'node:path';import {fileURLToPath} from 'node:url';
import {fixture,ctx} from './package1-helpers.mjs';
import {GAMES,SEED} from '../../tgcloud/lib/rr/generated.js';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const f=await fixture({pack:SEED,builds:GAMES});f.setTime(new Date().toISOString());
const seed8={schemaVersion:1,id:'eight',name:'Восемь кассет',directors:Array.from({length:4},(_,i)=>({id:'table-'+i,name:'Категория '+(i+1),films:[0,1].map(j=>({id:`tape-${i}-${j}`,title:`Кассета ${i+1}.${j+1}`,year:null,status:'approved'}))}))};
let model=await f.catalog.read({},ctx(101));
for(const [action,input]of [['createCatalog',{id:'eight',name:'Восемь кассет',catalog:seed8}],['publishCatalog',{id:'eight'}],['createRelease',{id:'eight',name:'Восемь кассет',gameVersionId:'v09-contests',catalogVersionId:'eight'}],['publishRelease',{id:'eight',visibility:'unlisted'}]]){model=await f.catalog.command({action,input,expectedRevision:model.revision},ctx(101));}
const mapping={rrAdminStatus:'status',rrAdminRead:'read',rrAdminCommand:'command',rrGetLaunch:'launch'};
const inject=`<script>
window.__sdkCalls=[];window.__sdkEvents={};
window.Telegram={WebApp:{initData:'SYNTHETIC_LOCAL_TEST_ONLY',platform:/iPhone|Android/.test(navigator.userAgent)?'ios':'tdesktop',version:'9.6',viewportStableHeight:innerHeight,viewportHeight:innerHeight,isFullscreen:false,
 safeAreaInset:{top:0,right:0,bottom:0,left:0},contentSafeAreaInset:{top:0,right:0,bottom:0,left:0},themeParams:{},
 ready(){},expand(){},enableVerticalSwipes(){},disableVerticalSwipes(){},setHeaderColor(){},setBackgroundColor(){},setBottomBarColor(){},enableClosingConfirmation(){},disableClosingConfirmation(){},isVersionAtLeast(){return true;},
 onEvent(n,f){(window.__sdkEvents[n] ||= []).push(f)},
 requestFullscreen(){this.isFullscreen=true;this.safeAreaInset={top:44,bottom:34,left:0,right:0};this.contentSafeAreaInset={top:48,bottom:0,left:0,right:0};for(const n of ['safeAreaChanged','contentSafeAreaChanged','fullscreenChanged'])for(const f of window.__sdkEvents[n]||[])f();},
 exitFullscreen(){this.isFullscreen=false;for(const f of window.__sdkEvents.fullscreenChanged||[])f();},
 BackButton:{show(){},hide(){},onClick(){}},HapticFeedback:{impactOccurred(){},notificationOccurred(){}},openTelegramLink(u){window.__openedLink=u;},
 Serverless:{call(name,input,cb){window.__sdkCalls.push({name,input});
 fetch('/__test_api',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name,input,uid:Number(sessionStorage.testUser||101),start:sessionStorage.testStart||''})}).then(r=>r.json()).then(r=>{if(name==='rrContest'&&input.action==='finish'&&sessionStorage.dropFinishAck==='1'){sessionStorage.dropFinishAck='0';cb({message:'Lost acknowledgement (local test)',parameters:{code:'TIMEOUT'}});return;}cb(r.error||null,r.result);}).catch(e=>cb({message:e.message}));}}
}};
</script>`;
const server=http.createServer(async(req,res)=>{try{const url=new URL(req.url,'http://localhost');
 if(url.pathname==='/__test_api'){
  let text='';for await(const b of req){text+=b;if(text.length>45*1024*1024)throw Error('Too big');}const {name,input={},uid=101,start=''}=JSON.parse(text),c={initData:{user:{id:uid,first_name:'Участник '+uid,username:'player_'+uid},start_param:start,auth_date:12345}};let result;
  try{
   if(name==='rrContest')result=await f.service[input.action](input,c);
   else if(name==='rrBackup')result=await f.backup[input.action](input,c);
   else if(name==='checkAccess')result={allowed:uid!==404,joinUrl:uid===404?'https://t.me/redrooms_stage':null};
   else if(name==='__inspection'){result={records:await f.store.view(await f.store.head()).list(),sent:f.sent.map(x=>({uid:x.uid,name:x.name,bytes:x.bytes.length}))};}
   else if(name==='rrSendSetLink'){await f.catalog.read({},c);result={sent:true};}
   else if(name==='rrGetLaunch'&&uid===404){const e=Error('subscription');e.code='SUBSCRIPTION_REQUIRED';e.joinUrl='https://t.me/redrooms_stage';throw e;}
   else if(name==='rrGetLaunch'&&input.previewCatalogId){const p=await f.service.preview({catalogId:input.previewCatalogId},c),g=GAMES.find(g=>g.id==='v11-access-entry') || GAMES.find(g=>g.id==='v10-clean-start') || GAMES.find(g=>g.id==='v09-contests');result={game:g,runtime:g,catalog:p.catalog,previewCatalogId:p.previewCatalogId,previewLobby:p,userId:uid,isAdmin:true,release:{id:p.releaseId,name:p.name,catalogVersionId:p.catalogVersionId}};}
   else if(name==='rrAdminCommand'&&input.action==='cloneCatalog'){const m=await f.catalog.read({},c);if(m.revision!==input.expectedRevision)throw Error('conflict');await f.service.adminCommand({command:'cloneSet',...input.input,expectedRevision:(await f.store.head()).revision},c);result=await f.catalog.read({},c);}
   else {if(!mapping[name])throw Error('unknown API');result=await f.catalog[mapping[name]](input,c);if(name==='rrAdminStatus'&&result.isAdmin)result.botUsername='vitalkino_stage_bot';}
   res.setHeader('Content-Type','application/json');res.end(JSON.stringify({result}));
  }catch(e){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({error:{message:e.message,parameters:{code:e.code,joinUrl:e.joinUrl}}}));}return;
 }
 if(url.pathname.endsWith('/index.html')){res.writeHead(302,{Location:url.pathname.slice(0,-10)+url.search});res.end();return;}
 let rel=decodeURIComponent(url.pathname).slice(1);if(!rel||rel.endsWith('/'))rel+='index.html';if(rel==='admin'||rel==='admin-advanced')rel+='.html';
 const file=path.resolve(root,'public',rel);if(!file.startsWith(path.join(root,'public')+path.sep)||!fs.existsSync(file)||!fs.statSync(file).isFile()){res.writeHead(404);res.end('not found');return;}
 const ext=path.extname(file),types={'.html':'text/html','.mjs':'text/javascript','.js':'text/javascript','.css':'text/css','.json':'application/json'};res.setHeader('Content-Type',(types[ext]||'application/octet-stream')+'; charset=utf-8');res.setHeader('Cache-Control','no-store');
 let body=fs.readFileSync(file);if(ext==='.html'){body=body.toString().replace(/<head\b[^>]*>/i,m=>m+inject);
  body=body.replace('window.RR_GAME_READY = true;',`window.__gameTest={solve(wrong=0){const remaining=tapeObjects.filter(t=>!t.userData.shelved);if(wrong&&remaining.length){takeTape(remaining[0]);for(let i=0;i<wrong;i++)putTapeOnShelf(shelfGroups.find(s=>s.userData.director!==remaining[0].userData.film.director).userData.director);}for(const tape of remaining){if(!heldTape)takeTape(tape);putTapeOnShelf(tape.userData.film.director);}},one(){const tape=tapeObjects.find(t=>!t.userData.shelved);takeTape(tape);putTapeOnShelf(tape.userData.film.director);},get state(){return {correctCount,attempts,SAVE_KEY,started,finished,save:localStorage.getItem(SAVE_KEY)}}};window.RR_GAME_READY = true;`);
 }res.end(body);
 }catch(e){res.writeHead(500);res.end(e.message);}});
const port=Number(process.env.RR_TEST_PORT||4201);server.listen(port,'127.0.0.1',()=>console.log('PACKAGE1 LOCAL SQLITE BROWSER '+port));
process.on('SIGTERM',()=>server.close(()=>{f.close();process.exit();}));
