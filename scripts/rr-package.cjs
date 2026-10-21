#!/usr/bin/env node
'use strict';
/** Create a full merged project ZIP without dependencies. Run AFTER prepare in the real checkout. */
const fs=require('node:fs'),path=require('node:path'),zlib=require('node:zlib'),crypto=require('node:crypto');
const root=path.resolve(__dirname,'..');
if(!fs.existsSync(path.join(root,'src/rr-legacy-v06.html'))||!fs.existsSync(path.join(root,'config/rr-built-games.json')))throw new Error('Сначала примените пакет к существующему репозиторию и выполните rr-prepare.cjs. Это ещё не полный проект.');
const allowed=['.github','config','docs','examples','public','scripts','src','tests','tgcloud'];
const top=['.gitignore','AGENTS.md','README.md','START-HERE.md','CHANGELOG.md','package.json','package-lock.json','tgcloud.jsonc'];
const files=[];
function scan(rel){const p=path.join(root,rel),s=fs.lstatSync(p);if(s.isSymbolicLink())throw new Error('Символические ссылки не пакуются: '+rel);if(s.isDirectory()){for(const n of fs.readdirSync(p))if(!['node_modules','.git','.tgcloud','.rr-test','__pycache__'].includes(n))scan(rel+'/'+n);}else if(!/\.local\.json$|\.rr-tmp$|\.pyc$|(^|\/)\.env/.test(rel)&&rel!=='tgcloud/lib/rr/config.js')files.push(rel);}
for(const d of allowed)if(fs.existsSync(path.join(root,d)))scan(d);
for(const p of top)if(fs.existsSync(path.join(root,p)))files.push(p);
const table=Array.from({length:256},(_,n)=>{for(let k=0;k<8;k++)n=n&1?0xedb88320^(n>>>1):n>>>1;return n>>>0;});
function crc(buf){let c=0xffffffff;for(const b of buf)c=table[(c^b)&255]^(c>>>8);return(c^0xffffffff)>>>0;}
const local=[],central=[];let offset=0;
for(const file of files.sort()){
 const name=Buffer.from('redrooms/'+file),data=fs.readFileSync(path.join(root,file)),compressed=zlib.deflateRawSync(data),sum=crc(data);
 if(data.length>0xffffffff)throw new Error('ZIP64 не поддерживается.');
 const h=Buffer.alloc(30);h.writeUInt32LE(0x04034b50);h.writeUInt16LE(20,4);h.writeUInt16LE(0x800,6);h.writeUInt16LE(8,8);h.writeUInt16LE(33,12);h.writeUInt32LE(sum,14);h.writeUInt32LE(compressed.length,18);h.writeUInt32LE(data.length,22);h.writeUInt16LE(name.length,26);
 const c=Buffer.alloc(46);c.writeUInt32LE(0x02014b50);c.writeUInt16LE(20,4);c.writeUInt16LE(20,6);c.writeUInt16LE(0x800,8);c.writeUInt16LE(8,10);c.writeUInt16LE(33,14);c.writeUInt32LE(sum,16);c.writeUInt32LE(compressed.length,20);c.writeUInt32LE(data.length,24);c.writeUInt16LE(name.length,28);c.writeUInt32LE(offset,42);
 local.push(h,name,compressed);central.push(c,name);offset+=h.length+name.length+compressed.length;
}
const cd=Buffer.concat(central),end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50);end.writeUInt16LE(files.length,8);end.writeUInt16LE(files.length,10);end.writeUInt32LE(cd.length,12);end.writeUInt32LE(offset,16);
const output=path.resolve(process.argv[2]||path.join(root,'..','redrooms-full-admin-releases.zip'));
const zip=Buffer.concat([...local,cd,end]);fs.writeFileSync(output,zip);console.log(`${output}\n${files.length} files; ${zip.length} bytes; SHA256 ${crypto.createHash('sha256').update(zip).digest('hex')}`);
