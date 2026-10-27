/** Local-source CLI preflight on the REAL deployed database, after additive migration.
 * Writes only an isolated probe generation, never the active head or player data. */
import {bindSQL} from './sdk-bind.mjs';
export async function probeStorage(raw,newId=()=>Date.now().toString(36)+'-'+Math.random().toString(36).slice(2)){
 const g='probe-'+newId(),p={':g':g,':id':g+':test',':payload':JSON.stringify({text:'Проверка',number:42})};
 try{
  const result=await raw.run("INSERT INTO rr_records(row_id,generation,entity_key,kind,revision,payload) SELECT :id,:g,'test','probe',0,:payload WHERE NOT EXISTS(SELECT 1 FROM rr_records WHERE generation=:g)",p);
  if(Number(result.rowsAffected??result.changes)!==1)throw Error('Raw write affected-row contract failed');
  const a=await raw.get('SELECT payload FROM rr_records WHERE generation=:g',{':g':g}),all=await raw.all('SELECT payload FROM rr_records WHERE generation=:g',{':g':g});
  if(typeof a?.payload!=='string'||all?.length!==1||JSON.parse(a.payload).number!==42)throw Error('Raw read mode/JSON contract failed');
  return {ok:true,rawReads:true,rawWrite:true,jsonRoundTrip:true};
 }finally{await raw.run("DELETE FROM rr_records WHERE generation=:g AND kind='probe'",{':g':g});}
}
