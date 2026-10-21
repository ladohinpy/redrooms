#!/usr/bin/env node
/** Explicit, staged production deployment. Never called by prepare or tests. */
'use strict';
const fs=require('node:fs'),path=require('node:path'),{spawnSync}=require('node:child_process');
const root=path.resolve(__dirname,'..');
if(!process.argv.includes('--confirm')){
  console.error('Деплой не запущен. Прочитайте docs/RELEASE-DEPLOY.md, затем: node scripts/rr-deploy.cjs --confirm');process.exit(1);
}
function node(script,args=[]){const r=spawnSync(process.execPath,[script,...args],{cwd:root,stdio:'inherit'});if(r.status!==0)process.exit(r.status||1);}
// Resolve a PINNED local CLI. Do not silently fetch and execute a different version.
let pkgPath;
try{pkgPath=path.join(root,'node_modules/@tgcloud/cli/package.json');fs.accessSync(pkgPath);}catch{console.error('Установите CLI: npm install --save-dev --save-exact @tgcloud/cli@0.2.0');process.exit(1);}
const pkg=JSON.parse(fs.readFileSync(pkgPath,'utf8'));
if(pkg.version!=='0.2.0'){console.error('Требуется проверяемый контракт CLI 0.2.0; установлен '+pkg.version+'. Сверьте изменения SDK перед обновлением версии.');process.exit(1);}
const bin=typeof pkg.bin==='string'?pkg.bin:pkg.bin?.tgcloud;
if(!bin)throw new Error('У CLI не найден executable tgcloud.');
const cli=path.resolve(path.dirname(pkgPath),bin);
function cloud(args){console.log('\n> tgcloud '+args.slice(0,2).join(' '));const r=spawnSync(process.execPath,[cli,...args],{cwd:root,stdio:'inherit'});if(r.status!==0){console.error('Публикация остановлена. Следующие этапы НЕ выполнены. Не используйте --force.');process.exit(r.status||1);}}
node('scripts/rr-prepare.cjs',['--production']);node('scripts/rr-check.cjs');
cloud(['fetch']);
// Include existing membership dependency without touching the bot's other handlers.
cloud(['push','tgcloud/schema.js','tgcloud/lib/rr/','tgcloud/lib/subscription.js','tgcloud/endpoints/checkAccess.js','tgcloud/endpoints/rrAdminStatus.js','tgcloud/endpoints/rrAdminRead.js','tgcloud/endpoints/rrAdminCommand.js','tgcloud/endpoints/rrGetLaunch.js','tgcloud/endpoints/rrHealth.js']);
cloud(['migrate','--dry-run']);
cloud(['migrate','--safe']); // Additive schema only. No yes/force/drop shortcuts.
const config=fs.readFileSync(path.join(root,'tgcloud/lib/rr/config.js'),'utf8');
const ids=JSON.parse(config.match(/Object\.freeze\((\[[\s\S]*?\])\)/)[1]);
// CLI Access is privileged. Synthetic ctx is ONLY for this local CLI smoke test,
// never accepted by public client calls. rrHealth is still an admin-only endpoint.
cloud(['run','endpoints/rrHealth','{}','--ctx',JSON.stringify({initData:{user:{id:ids[0]}}})]);
cloud(['push','public/']);
console.log('\nПубликация завершена. Откройте Mini App в Telegram и выполните ручной smoke-check из документации. URL бота и прежний CLI token не менялись.');
