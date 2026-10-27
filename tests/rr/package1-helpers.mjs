import {DatabaseSync} from 'node:sqlite';
import {createRecordStore,RECORD_DDL,catalogRepository} from '../../src/rr/record-store.mjs';
import {createContestService} from '../../src/rr/contest-service.mjs';
import {createBackupService} from '../../src/rr/backup-service.mjs';
import {createService} from '../../src/rr/service.mjs';
import {createInitialState,clone} from '../../src/rr/domain.mjs';
import {seed,games,ctx,memoryRepository} from './helpers.mjs';
export {seed,games,ctx};
export async function fixture({pack=seed,builds=games,environment='stage',botId=444,allowed=true}={}){
 const sql=new DatabaseSync(':memory:');sql.exec(RECORD_DDL);
 const raw={
  async get(s,p={}){return sql.prepare(s).get(p);},async all(s,p={}){return sql.prepare(s).all(p);},
  async run(s,p={}){const x=sql.prepare(s);if(/^\s*(SELECT|PRAGMA)/i.test(s))return {rows:x.all(p),rowsAffected:0};const r=x.run(p);return {rowsAffected:Number(r.changes),rows:[]};}
 };
 let at='2026-10-27T10:00:00.000Z',seq=0;const now=()=>at,newId=()=>('test-'+(++seq).toString().padStart(6,'0'));
 const store=createRecordStore(raw,{environment,botId,random:newId}),old=memoryRepository();
 await old.initialize(createInitialState(pack,builds,at));const repository=catalogRepository(store,old);await repository.read();
 const checkSubscription=async()=>({allowed,joinUrl:'https://t.me/redrooms_stage'}),adminIds=[101,202];
 const service=createContestService({store,adminIds,checkSubscription,getBotUsername:async()=>'vitalkino_stage_bot',now,newId});
 const catalog=createService({repository,adminIds,games:builds,seed:pack,checkSubscription,now});
 const sent=[];let rejectRecipient=null;
 const backup=createBackupService({store,adminIds,availableGames:builds,now,newId,sendDocument:async(uid,name,bytes,caption)=>{if(uid===rejectRecipient)throw Error('delivery refused');sent.push({uid,name,bytes:Buffer.from(bytes),caption});}});
 const command=async(command,args={})=>service.adminCommand({command,releaseId:'classic-1',...args,expectedRevision:(await store.head()).revision},ctx(101));
 const start=async(uid=303,requestId='request-0001',releaseId='classic-1')=>service.start({releaseId,requestId},ctx(uid));
 const payload=(wrong=0)=>{const answers=pack.directors.flatMap(d=>d.films.map(f=>({filmId:f.id,tableId:d.id})));const actions=[...Array.from({length:wrong},()=>({filmId:answers[0].filmId,tableId:pack.directors[1].id})),...answers].map((x,i)=>({...x,seq:i+1}));return {answers,actions,counters:{placements:actions.length},score:1000000,accuracy:100};};
 return {sql,raw,store,old,repository,catalog,service,backup,sent,command,start,payload,now,newId,setTime:x=>at=x,advance:ms=>at=new Date(Date.parse(at)+ms).toISOString(),deliveryFails:uid=>rejectRecipient=uid,close:()=>sql.close()};
}
