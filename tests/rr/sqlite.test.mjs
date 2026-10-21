import {test} from 'node:test';import assert from 'node:assert/strict';import {DatabaseSync} from 'node:sqlite';import fs from 'node:fs';
// Execute the ACTUAL repository source against a small SDK-shape adapter backed
// by SQLite. This verifies repository SQL semantics, not Telegram SDK compatibility.
async function sqlRepo(){
 const sql=new DatabaseSync(':memory:');sql.exec('CREATE TABLE rr_admin_state (id TEXT PRIMARY KEY NOT NULL, revision INTEGER NOT NULL, state_json TEXT NOT NULL)');
 const cols={id:'id',revision:'revision',state:'state_json'};
 const decode=r=>r?{id:r.id,revision:r.revision,state:JSON.parse(r.state_json)}:null;
 const db={
  select(){return{from(){return this;},where(c){this.c=c;return this;},async get(){return decode(sql.prepare('SELECT * FROM rr_admin_state WHERE '+this.c.sql).get(...this.c.values));}};},
  insert(){return{values(v){this.v=v;return this;},onConflictDoUpdate(c){assert.equal(c.target,'id');assert.deepEqual(c.set,{id:'application'});return this;},returning(){return this;},async run(){return sql.prepare('INSERT INTO rr_admin_state(id,revision,state_json) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET id=excluded.id RETURNING *').all(this.v.id,this.v.revision,JSON.stringify(this.v.state)).map(decode);}};},
  update(){return{set(v){this.v=v;return this;},where(c){this.c=c;return this;},returning(){return this;},async run(){return sql.prepare('UPDATE rr_admin_state SET revision=?, state_json=? WHERE '+this.c.sql+' RETURNING *').all(this.v.revision,JSON.stringify(this.v.state),...this.c.values).map(decode);}};}
 };
 globalThis.__rr_sql_test={db,rrAdminState:cols,eq:(col,v)=>({sql:col+' = ?',values:[v]}),and:(...c)=>({sql:c.map(x=>'('+x.sql+')').join(' AND '),values:c.flatMap(x=>x.values)})};
 let source=fs.readFileSync(new URL('../../tgcloud/lib/rr/store.js',import.meta.url),'utf8').replace(/^import .*?;\n/gm,'');source='const {db,eq,and,rrAdminState}=globalThis.__rr_sql_test;\n'+source+'\n// '+Math.random();
 const {repository}=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));delete globalThis.__rr_sql_test;
 return {repository,close:()=>sql.close()};
}
test('actual repository: SQLite JSON insert/read and non-resetting initialization',async()=>{const {repository:r,close}=await sqlRepo();try{assert.equal(await r.read(),null);assert.equal((await r.initialize({name:'Кино 🎥'})).revision,1);assert.equal((await r.initialize({name:'WRONG'})).state.name,'Кино 🎥');assert.equal((await r.read()).state.name,'Кино 🎥');}finally{close();}});
test('actual repository: conditional update fails on stale revision without data loss',async()=>{const {repository:r,close}=await sqlRepo();try{await r.initialize({release:'old'});assert.equal((await r.compareSwap(1,{release:'new',audit:['switch']})).revision,2);assert.equal(await r.compareSwap(1,{release:'bad'}),null);assert.deepEqual((await r.read()).state,{release:'new',audit:['switch']});}finally{close();}});
