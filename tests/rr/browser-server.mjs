/** LOCAL-ONLY browser harness. Synthetic identities; NEVER put under public/ or deploy. */
import http from 'node:http';import fs from 'node:fs';import path from 'node:path';import os from 'node:os';import {spawnSync} from 'node:child_process';import {fileURLToPath} from 'node:url';
import {createService} from '../../src/rr/service.mjs';import {seed,legacyFixture,ctx,memoryRepository} from './helpers.mjs';
const source=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'rr-browser-'));
for(const p of ['src','public','scripts','tgcloud','config'])fs.cpSync(path.join(source,p),path.join(root,p),{recursive:true});
const write=(p,s)=>{fs.mkdirSync(path.dirname(path.join(root,p)),{recursive:true});fs.writeFileSync(path.join(root,p),s);};
for(const f of ['config/rr-built-games.json','config/rr-admins.local.json','src/rr-legacy-v06.html'])fs.rmSync(path.join(root,f),{force:true});
write('config/rr-game-builds.json',JSON.stringify({schemaVersion:1,games:[{id:'v06',name:'Классическая комната v06',source:'src/rr-legacy-v06.html',adapter:'v06',aliases:['v1']}]}));
write('public/index.html',legacyFixture());write('public/access-gate.js','// Browser test fixture only.');write('tgcloud/endpoints/checkAccess.js','export default async()=>({allowed:true});');write('tgcloud/schema.js','');write('tgcloud.jsonc','{"static":{"source":"public"}}');
const result=spawnSync(process.execPath,[path.join(root,'scripts/rr-prepare.cjs')],{encoding:'utf8',env:{...process.env,RR_ADMIN_IDS:'101,202'}});if(result.status!==0)throw new Error(result.stderr);
const games=JSON.parse(fs.readFileSync(path.join(root,'config/rr-built-games.json'),'utf8')).games;
const service=createService({repository:memoryRepository(),adminIds:[101,202],games,seed,checkSubscription:async ctx=>({allowed:ctx.initData.user.id!==404,joinUrl:'https://t.me/redrooms_stage'})});
const names={rrAdminStatus:'status',rrAdminRead:'read',rrAdminCommand:'command',rrGetLaunch:'launch'};
const inject=`<script>window.Telegram={WebApp:{initData:'LOCAL_TEST_ONLY',ready(){},openTelegramLink(u){window.testOpenedLink=u;},Serverless:{call(name,input,callback){fetch('/__test_api',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({name,input,uid:Number(sessionStorage.testUser||101),start:sessionStorage.testStart||''})}).then(r=>r.json()).then(r=>callback(r.error||null,r.result)).catch(e=>callback({message:e.message}));}}}};</script>`;
const server=http.createServer(async(req,res)=>{
 try{
 if(req.url==='/__test_api'){
  let text='';for await(const b of req){text+=b;if(text.length>1_100_000)throw new Error('Too large');}const {name,input,uid,start}=JSON.parse(text);
  try{const method=names[name];if(!method)throw new Error('Unknown method');const result=await service[method](input,ctx(uid,start));res.setHeader('Content-Type','application/json');res.end(JSON.stringify({result}));}
  catch(e){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({error:{message:e.message,parameters:{code:e.code,joinUrl:e.joinUrl}}}));}return;
 }
 const pathname=new URL(req.url,'http://localhost').pathname,rel=decodeURIComponent(pathname)==='/'?'index.html':decodeURIComponent(pathname).slice(1),p=path.resolve(root,'public',rel);
 if(!p.startsWith(path.join(root,'public')+path.sep)){res.writeHead(403);res.end();return;}
 if(!fs.existsSync(p)||!fs.statSync(p).isFile()){res.writeHead(404);res.end('Not found');return;}
 const ext=path.extname(p),types={'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.json':'application/json'};
 res.setHeader('Content-Type',(types[ext]||'application/octet-stream')+'; charset=utf-8');res.setHeader('Cache-Control','no-store');
 let body=fs.readFileSync(p);if(ext==='.html')body=body.toString().replace('<head>','<head>'+inject);res.end(body);
 }catch(e){res.writeHead(500);res.end(e.message);}
});
const port=Number(process.env.RR_TEST_PORT||4186);server.listen(port,'127.0.0.1',()=>console.log(`TEST ONLY http://127.0.0.1:${port}/admin.html (synthetic 101/202; ${root})`));
const close=()=>server.close(()=>{fs.rmSync(root,{recursive:true,force:true});process.exit();});process.on('SIGTERM',close);process.on('SIGINT',close);
