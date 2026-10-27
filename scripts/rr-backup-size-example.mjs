#!/usr/bin/env node
/** Synthetic sizing only. No server, no network, no real players. Prints bytes of
 * the actual backup format using real catalog and two representative attempts. */
import {fixture,ctx} from '../tests/rr/package1-helpers.mjs';
import {GAMES,SEED} from '../tgcloud/lib/rr/generated.js';
import {packBackup} from '../src/rr/backup.mjs';
const measurements=[];
for(const count of [20,201]){
 const pack=structuredClone(SEED);if(count===20)for(const d of pack.directors)d.films=d.films.slice(0,5);
 const f=await fixture({pack,builds:GAMES});await f.command('activate');
 for(let slot=1;slot<=2;slot++){const a=await f.start(303,'size-request-'+slot);f.advance(120000);await f.service.finish({attemptId:a.attempt.id,...f.payload(slot)},ctx(303));}
 const example=(await f.backup.export({},ctx(101))).records,base=example.filter(r=>!['player','attempt','request','reservation'].includes(r.kind)),person=example.filter(r=>['player','attempt','request','reservation'].includes(r.kind));
 for(const users of [100,1000]){
  const records=base.slice();
  for(let i=0;i<users;i++)for(const r of person){const t=JSON.stringify(r).replaceAll('a-test-000002','a-test-'+i+'-000002').replaceAll('a-test-000003','a-test-'+i+'-000003');let x=JSON.parse(t); // Size, not a restorable fixture; identities remain synthetic.
   x.key='size-'+i+':'+x.key;records.push(x);}
  const b=packBackup(records,{revision:1},{at:'2026-10-27T00:00:00.000Z',botId:444,environment:'stage'});
  const bytes=Buffer.byteLength(JSON.stringify(b));measurements.push({scenario:'synthetic',filmsPerSet:count,players:users,completedAttemptsPerPlayer:2,bytes,MiB:Number((bytes/1048576).toFixed(2)),includes:'raw answers/actions, reservations, idempotency keys, players, catalog, audit; no images'});
 }
 f.close();
}
const fresh=await fixture({pack:SEED,builds:GAMES}),initial=await fresh.backup.export({},ctx(101));measurements.unshift({scenario:'actual initial format with supplied 201-film seed, no real database',bytes:Buffer.byteLength(JSON.stringify(initial)),KiB:Number((Buffer.byteLength(JSON.stringify(initial))/1024).toFixed(1))});fresh.close();
console.log(JSON.stringify({note:'Sizing uses synthetic player data, two attempts each, one set. Not the user live database. No images/base64 in backup. App limit 40 MiB.',measurements},null,2));
