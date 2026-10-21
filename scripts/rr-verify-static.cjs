#!/usr/bin/env node
/** Optional read-only PUBLIC-asset check. No token, no authenticated API, no writes. */
'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
async function verify(root,base,fetcher=fetch){
 const origin=new URL(base);if(origin.protocol!=='https:' || origin.username||origin.password||origin.search||origin.hash)throw Error('Нужен чистый HTTPS-адрес приложения, без ключей и параметров.');
 const m=JSON.parse(fs.readFileSync(path.join(root,'config/rr-built-games.json'),'utf8'));
 const g=m.games.find(g=>g.id==='v08-player-ui') || m.games.find(g=>g.id==='v07-tables');if(!g)throw Error('Не найдена сборка v07-tables.');
 const paths=['/index.html','/admin.html','/rr/admin.mjs','/rr/client.mjs',g.entry,...g.runtimeAssets.map(a=>'/'+a.path)];
 const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
 for(const rel of new Set(paths)){
   const r=await fetcher(new URL(rel,origin).href,{redirect:'follow',cache:'no-store',signal:AbortSignal.timeout(15000)});
   if(!r.ok)throw Error(`HTTP ${r.status}: ${rel}`);
   if(r.url && new URL(r.url).origin!==origin.origin)throw Error('Неожиданный переход на другой домен: '+rel);
   const body=Buffer.from(await r.arrayBuffer());const local=fs.readFileSync(path.join(root,'public',rel));
   if(sha(body)!==sha(local))throw Error('На сервере другая версия файла: '+rel+'. Не повторяйте публикацию вслепую; проверьте выбранный бот/ветку и кэш.');
   if(/\.mjs$/.test(rel)&&!/(?:javascript|ecmascript)/i.test(r.headers.get('content-type')||''))throw Error('Неверный MIME-type JS: '+rel);
 }
 return paths.length;
}
if(require.main===module){verify(path.resolve(__dirname,'..'),process.argv[2]||process.env.RR_APP_URL||'https://app8804859840.tgcloud.ai/').then(n=>console.log(`PUBLIC ASSETS OK (${n} checks). This is NOT an authenticated Telegram test.`)).catch(e=>{console.error(e.message);process.exitCode=1;});}
module.exports={verify};
