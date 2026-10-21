/** LOCAL-ONLY integration server for the REAL bundled 3D game and admin.
 * Synthetic SDK/IDs and in-memory database, NEVER deploy this file or /__test_api.
 * Usage: RR_TEST_ROOT=/path/to/checkout RR_TEST_PORT=4197 RR_CANONICAL=1 node this-file
 */
import http from 'node:http';import fs from 'node:fs';import path from 'node:path';import {fileURLToPath,pathToFileURL} from 'node:url';
const root=path.resolve(process.env.RR_TEST_ROOT || path.join(path.dirname(fileURLToPath(import.meta.url)),'../..'));
const {createService}=await import(pathToFileURL(path.join(root,'src/rr/service.mjs')));
const {GAMES,SEED}=await import(pathToFileURL(path.join(root,'tgcloud/lib/rr/generated.js')));
const {memoryRepository,ctx}=await import(pathToFileURL(path.join(root,'tests/rr/helpers.mjs')));
const service=createService({repository:memoryRepository(),adminIds:[101,202],games:GAMES,seed:SEED,checkSubscription:async c=>({allowed:c.initData.user.id!==404,joinUrl:'https://t.me/redrooms_stage'})});
const mapping={rrAdminStatus:'status',rrAdminRead:'read',rrAdminCommand:'command',rrGetLaunch:'launch'};
const inject=`<script>
window.__localSDKEvents={};window.__localSDKCalls=[];
window.Telegram={WebApp:{initData:'SYNTHETIC_LOCAL_TEST_ONLY',platform:/iPhone|Android/.test(navigator.userAgent)?'ios':'tdesktop',version:'9.6',viewportStableHeight:innerHeight,viewportHeight:innerHeight,isFullscreen:false,
 safeAreaInset:{top:0,right:0,bottom:0,left:0},contentSafeAreaInset:{top:0,right:0,bottom:0,left:0},themeParams:{},
 ready(){},expand(){},enableVerticalSwipes(){},disableVerticalSwipes(){},setHeaderColor(){},setBackgroundColor(){},setBottomBarColor(){},enableClosingConfirmation(){},disableClosingConfirmation(){},isVersionAtLeast(){return true;},
 onEvent(n,f){(window.__localSDKEvents[n] ||= []).push(f)},
 requestFullscreen(){this.isFullscreen=true;this.safeAreaInset={top:44,bottom:34,left:0,right:0};this.contentSafeAreaInset={top:48,bottom:0,left:0,right:0};for(const n of ['safeAreaChanged','contentSafeAreaChanged','fullscreenChanged'])for(const f of window.__localSDKEvents[n]||[])f();},
 exitFullscreen(){this.isFullscreen=false;for(const f of window.__localSDKEvents.fullscreenChanged||[])f();},
 BackButton:{show(){},hide(){},onClick(){}},HapticFeedback:{impactOccurred(){},notificationOccurred(){}},openTelegramLink(u){window.__testOpened=u;},
 Serverless:{call(name,input,cb){window.__localSDKCalls.push(name);if(sessionStorage.testTimeout==='1')return;
 fetch('/__test_api',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name,input,uid:Number(sessionStorage.testUser||101),start:sessionStorage.testStart||''})}).then(r=>r.json()).then(r=>cb(r.error||null,r.result)).catch(e=>cb({message:e.message}));}}
}};
</script>`;
const canonical=process.env.RR_CANONICAL==='1';
const server=http.createServer(async(req,res)=>{try{
 const url=new URL(req.url,'http://localhost');
 if(url.pathname==='/__test_api'){
  let text='';for await(const b of req){text+=b;if(text.length>1200000)throw Error('Too large');}
  const {name,input,uid,start}=JSON.parse(text);let result;
  try{
   if(name==='checkAccess')result={allowed:uid!==404,joinUrl:uid!==404?null:'https://t.me/redrooms_stage'};
   else if(name==='rrSendSetLink'){const row=await service.read({},ctx(uid,start));if(!row.state.game_releases.some(r=>r.id===input.releaseId&&r.status==='published'))throw Error('Not published');result={sent:true,to:uid};}
   else {if(!mapping[name])throw Error('Unknown method');result=await service[mapping[name]](input,ctx(uid,start));if(name==='rrAdminStatus'&&result.isAdmin)result.botUsername='RedRoomTestBot';}
   res.setHeader('Content-Type','application/json');res.end(JSON.stringify({result}));
  }catch(e){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({error:{message:e.message,parameters:{code:e.code,joinUrl:e.joinUrl}}}));}return;
 }
 if(canonical && url.pathname.endsWith('/index.html')){res.writeHead(302,{Location:url.pathname.slice(0,-10)+url.search});res.end();return;}
 if(canonical && ['/admin.html','/admin-advanced.html'].includes(url.pathname)){res.writeHead(302,{Location:url.pathname.slice(0,-5)+url.search});res.end();return;}
 let rel=decodeURIComponent(url.pathname).slice(1);if(!rel || rel.endsWith('/'))rel+='index.html';
 if(rel==='admin'||rel==='admin-advanced')rel+='.html';
 const file=path.resolve(root,'public',rel);if(!file.startsWith(path.join(root,'public')+path.sep)){res.writeHead(403);res.end();return;}
 if(!fs.existsSync(file)||!fs.statSync(file).isFile()){res.writeHead(404);res.end('Not found');return;}
 const ext=path.extname(file),types={'.html':'text/html','.mjs':'text/javascript','.js':'text/javascript','.css':'text/css','.json':'application/json'};
 res.setHeader('Content-Type',(types[ext]||'application/octet-stream')+'; charset=utf-8');res.setHeader('Cache-Control','no-store');
 let body=fs.readFileSync(file);if(ext==='.html')body=body.toString().replace(/<head\b[^>]*>/i,m=>m+inject);res.end(body);
 }catch(e){res.writeHead(500);res.end(e.message);}});
const port=Number(process.env.RR_TEST_PORT||4198);server.listen(port,'127.0.0.1',()=>console.log(`LOCAL TEST ONLY ${port} root=${root} canonical=${canonical}`));
process.on('SIGTERM',()=>server.close(()=>process.exit()));
