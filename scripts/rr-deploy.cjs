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
// Repair only the known CLI post-deploy snapshot response. No cloud side effects.
try {
  const { installCliResponseFix } = require('./rr-cli-compat.cjs');
  installCliResponseFix(root);
  console.log('CLI 0.2.0 response guard ready. No deployment performed.');
} catch(error) {
  console.error('CLI compatibility check failed: ' + error.message); process.exit(1);
}
function cloud(args){console.log('\n> tgcloud '+args.map((arg,i)=>args[i-1]==='--ctx'?'[admin CLI test context]':arg).join(' '));const r=spawnSync(process.execPath,[cli,...args],{cwd:root,stdio:'inherit'});if(r.status!==0){console.error('Публикация остановлена. Следующие этапы НЕ выполнены. Не используйте --force.');process.exit(r.status||1);}}
node('scripts/rr-prepare.cjs',['--production']);node('scripts/rr-check.cjs');
const config=fs.readFileSync(path.join(root,'tgcloud/lib/rr/config.js'),'utf8');
const ids=JSON.parse(config.match(/Object\.freeze\((\[[\s\S]*?\])\)/)[1]);
const context=JSON.stringify({initData:{user:{id:ids[0]}}});
// CLI run uses local modules on Telegram; preflight/backup do not deploy code.
cloud(['run','endpoints/rrDeployment',JSON.stringify({action:'info'}),'--ctx',context]);
cloud(['run','endpoints/rrDeployment',JSON.stringify({action:'backup'}),'--ctx',context]);
cloud(['fetch']);
// Additive schema FIRST: the previous backend keeps working until new tables exist.
cloud(['push','tgcloud/schema.js']);
cloud(['migrate','--dry-run']);
cloud(['migrate','--safe']); // No yes/force/drop shortcuts.
cloud(['run','endpoints/rrDeployment',JSON.stringify({action:'probe'}),'--ctx',context]);
cloud(['push','tgcloud/lib/rr/','tgcloud/lib/subscription.js','tgcloud/endpoints/checkAccess.js','tgcloud/endpoints/rrAdminStatus.js','tgcloud/endpoints/rrAdminRead.js','tgcloud/endpoints/rrAdminCommand.js','tgcloud/endpoints/rrGetLaunch.js','tgcloud/endpoints/rrHealth.js','tgcloud/endpoints/rrSendSetLink.js','tgcloud/endpoints/rrContest.js','tgcloud/endpoints/rrBackup.js','tgcloud/endpoints/rrDeployment.js']);
cloud(['run','endpoints/rrHealth','{}','--ctx',context]);
cloud(['push','public/']);
console.log('Публикация завершена. Проверьте два аккаунта и обычного игрока в Telegram. База не сбрасывалась.');
