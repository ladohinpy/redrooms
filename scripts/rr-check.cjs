#!/usr/bin/env node
'use strict';
const fs=require('node:fs'),path=require('node:path'),{spawnSync}=require('node:child_process');
const root=path.resolve(__dirname,'..');
const testDir=path.join(root,'tests/rr');
const tests=fs.readdirSync(testDir).filter(n=>n.endsWith('.test.mjs')).map(n=>path.join(testDir,n));
const run=spawnSync(process.execPath,['--test',...tests],{cwd:root,stdio:'inherit'});
if(run.status!==0)process.exit(run.status||1);
if(!process.argv.includes('--tests-only')){
  for(const p of ['config/rr-built-games.json','tgcloud/lib/rr/generated.js','public/rr/admin.mjs'])if(!fs.existsSync(path.join(root,p))){console.error('Сначала выполните node scripts/rr-prepare.cjs. Нет '+p);process.exit(1);}
  const manifest=JSON.parse(fs.readFileSync(path.join(root,'config/rr-built-games.json'),'utf8'));
  const hash=s=>require('node:crypto').createHash('sha256').update(s).digest('hex');
  for(const g of manifest.games){
    const file=path.join(root,'public'+g.entry);if(!fs.existsSync(file)||hash(fs.readFileSync(file))!==g.codeHash)throw new Error('Игровая сборка изменена или потеряна: '+g.id);
    for(const a of g.runtimeAssets)if(hash(fs.readFileSync(path.join(root,'public',a.path)))!==a.hash)throw new Error('Runtime изменён: '+a.path);
  }
  console.log('BUILD INTEGRITY OK. Tests use local adapters; Telegram cloud integration is checked separately by rrHealth during deployment.');
}
