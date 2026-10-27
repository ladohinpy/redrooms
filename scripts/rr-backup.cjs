#!/usr/bin/env node
'use strict';
// Explicit/scheduled runner: only a read + private document delivery, never push/migrate.
const fs=require('node:fs'),path=require('node:path'),{spawnSync}=require('node:child_process');
const root=path.resolve(__dirname,'..');
if(!process.argv.includes('--confirm')){console.error('Для отправки JSON двум администраторам: node scripts/rr-backup.cjs --confirm');process.exit(1);}
function run(file,args){const r=spawnSync(process.execPath,[file,...args],{cwd:root,stdio:'inherit'});if(r.status!==0)process.exit(r.status||1);}
run('scripts/rr-prepare.cjs',['--production']);
const p=path.join(root,'node_modules/@tgcloud/cli/package.json'),pkg=JSON.parse(fs.readFileSync(p,'utf8'));if(pkg.version!=='0.2.0')throw Error('Нужен проверенный CLI 0.2.0');
const bin=path.resolve(path.dirname(p),typeof pkg.bin==='string'?pkg.bin:pkg.bin.tgcloud);
const config=fs.readFileSync(path.join(root,'tgcloud/lib/rr/config.js'),'utf8'),ids=JSON.parse(config.match(/Object\.freeze\((\[[\s\S]*?\])\)/)[1]);
run(bin,['run','endpoints/rrDeployment',JSON.stringify({action:'backup',scheduled:true}),'--ctx',JSON.stringify({initData:{user:{id:ids[0]}}})]);
