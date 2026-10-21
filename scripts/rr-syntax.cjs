#!/usr/bin/env node
/** Parse every shipped browser/server module before the cloud is touched. */
'use strict';
const fs=require('node:fs'),path=require('node:path'),{spawnSync}=require('node:child_process');
function files(dir){if(!fs.existsSync(dir))return [];return fs.readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?files(path.join(dir,e.name)):/\.(mjs|cjs|js)$/.test(e.name)?[path.join(dir,e.name)]:[]);}
function checkSyntax(root){let count=0;for(const dir of ['src/rr','public/rr','tgcloud','scripts'])for(const file of files(path.join(root,dir))){const r=spawnSync(process.execPath,['--check',file],{encoding:'utf8'});if(r.status!==0)throw new Error('Ошибка синтаксиса: '+path.relative(root,file)+'\n'+(r.stderr||r.stdout));count++;}return count;}
if(require.main===module){try{console.log(`JAVASCRIPT SYNTAX OK (${checkSyntax(path.resolve(__dirname,'..'))} files).`);}catch(e){console.error(e.message);process.exit(1);}}
module.exports={checkSyntax};
