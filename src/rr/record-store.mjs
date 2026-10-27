/**
 * Versioned logical records. Every commit is ONE SQLite statement containing
 * changed rows AND its head marker, conditional on the previous revision.
 * No unverified db.transaction API, process-global lock, or multi-call BEGIN.
 * Readers pin (generation, revision). Restore stages an invisible generation,
 * verifies it, then atomically switches the head with the same CAS protocol.
 */
import { clone, fail } from './domain.mjs';
export const RECORD_DDL = `CREATE TABLE IF NOT EXISTS rr_records (
 row_id TEXT PRIMARY KEY, generation TEXT NOT NULL, entity_key TEXT NOT NULL,
 kind TEXT NOT NULL, revision INTEGER NOT NULL, payload TEXT NOT NULL);
 CREATE INDEX IF NOT EXISTS rr_records_lookup ON rr_records(generation,entity_key,revision);
 CREATE INDEX IF NOT EXISTS rr_records_head ON rr_records(kind,revision);`;
const decode=r=>r?{key:r.entity_key,kind:r.kind,revision:Number(r.revision),data:typeof r.payload==='string'?JSON.parse(r.payload):r.payload}:null;
export function createRecordStore(db, { environment='stage', botId=null, random=()=>Date.now().toString(36)+'-'+Math.random().toString(36).slice(2)+Math.random().toString(36).slice(2) }={}) {
  async function head(){const r=await db.get("SELECT generation,revision,payload FROM rr_records WHERE kind='commit' ORDER BY revision DESC LIMIT 1",{});return r?{generation:r.generation,revision:Number(r.revision),meta:typeof r.payload==='string'?JSON.parse(r.payload):r.payload}:null;}
  function view(h){
    return {head:h,
      async get(key){return decode(await db.get(`SELECT * FROM rr_records WHERE generation=:g AND entity_key=:k AND revision<=:r ORDER BY revision DESC LIMIT 1`,{':g':h.generation,':k':key,':r':h.revision}));},
      async list(kind=null){return (await db.all(`SELECT a.* FROM rr_records a WHERE a.generation=:g AND a.revision<=:r AND a.kind!='commit' ${kind?"AND a.kind=:kind":""} AND a.revision=(SELECT MAX(b.revision) FROM rr_records b WHERE b.generation=a.generation AND b.entity_key=a.entity_key AND b.revision<=:r) ORDER BY a.entity_key`,{':g':h.generation,':r':h.revision,...(kind?{':kind':kind}:{})})).map(decode);}
    };
  }
  async function insertRows(rows, expected=null){
    if(!rows.length)return true;if(rows.length>40)fail('Слишком большая атомарная операция.','CAPACITY');
    const params={},columns=['row_id','generation','entity_key','kind','revision','payload'];
    const selects=rows.map((row,i)=>'SELECT '+columns.map((k,j)=>{params[':p'+i+'_'+j]=row[k];return ':p'+i+'_'+j+(i===0?' AS '+k:'');}).join(','));
    if(expected!==null)params[':expected']=expected;
    const result=await db.run(`INSERT INTO rr_records (${columns.join(',')}) SELECT * FROM (${selects.join(' UNION ALL ')})${expected===null?'':" WHERE (SELECT COALESCE(MAX(revision),0) FROM rr_records WHERE kind='commit')=:expected"}`,params);
    return Number(result.rowsAffected ?? result.changes)===rows.length;
  }
  const row=(g,r,k,kind,data)=>({row_id:g+':'+r+':'+k,generation:g,entity_key:k,kind,revision:r,payload:JSON.stringify(data)});
  async function commit(h,changes,meta={}){
    if(!h)fail('Хранилище не инициализировано.');
    if(!changes.length)return h;
    if(new Set(changes.map(x=>x.key)).size!==changes.length)fail('Дубли записи в одной операции.');
    const r=h.revision+1;
    const rows=changes.map(x=>row(h.generation,r,x.key,x.kind,x.data));
    rows.push(row(h.generation,r,'@head','commit',{...h.meta,...meta,environment,botId,formatVersion:1}));
    return await insertRows(rows,h.revision)?{generation:h.generation,revision:r,meta:{...h.meta,...meta,environment,botId,formatVersion:1}}:null;
  }
  async function initialize(admin,initialMeta={}){
    const existing=await head();if(existing)return existing;
    const g='initial',r=1,meta={...initialMeta,environment,botId,formatVersion:1,migratedAt:new Date().toISOString()};
    await insertRows([row(g,r,'admin','admin',admin),row(g,r,'@head','commit',meta)],0);return head();
  }
  async function transact(fn,{retries=8}={}){
    for(let i=0;i<retries;i++){
      const h=await head();if(!h)fail('Сначала выполните инициализацию хранилища.','NOT_READY');
      const result=await fn(view(h));
      if(!result.changes?.length)return result.value;
      if(await commit(h,result.changes,result.meta))return result.value;
    }
    fail('Данные сейчас обновляются. Повторите запрос; сохранённый результат не будет продублирован.','CONFLICT');
  }
  async function stageRestore(records){
    const generation='restore-'+random();
    for(let i=0;i<records.length;i+=30)await insertRows(records.slice(i,i+30).map(x=>row(generation,0,x.key,x.kind,x.data)));
    return generation;
  }
  async function publishRestore(expectedHead,generation,meta){
    const r=expectedHead.revision+1;
    const restoredAdmin=await view({generation,revision:0}).get('admin');if(!restoredAdmin)fail('В восстановлении отсутствует редакторская база.');
    // Give the restored catalog a positive revision and invalidate every old editor.
    const ok=await insertRows([row(generation,r,'admin','admin',restoredAdmin.data),row(generation,r,'@head','commit',{...expectedHead.meta,...meta,environment,botId,formatVersion:1})],expectedHead.revision);
    if(!ok)fail('Во время восстановления поступили новые данные. Рабочая база НЕ переключена. Создайте свежий бэкап и повторите проверку.','CONFLICT');
    return head();
  }
  async function putTransfer(token,key,kind,value) {
    if(!/^[a-z0-9-]{8,120}$/.test(token))fail('Некорректная передача.');
    const g='transfer-'+token,v=view({generation:g,revision:0}),old=await v.get(key);
    if(old){if(JSON.stringify(old.data)!==JSON.stringify(value))fail('Фрагмент уже записан с другим содержимым.','CONFLICT');return;}
    try{await insertRows([row(g,0,key,kind,value)]);}catch(error){const again=await v.get(key);if(!again||JSON.stringify(again.data)!==JSON.stringify(value))throw error;}
  }
  async function readTransfer(token,key) {if(!/^[a-z0-9-]{8,120}$/.test(token))fail('Некорректная передача.');return (await view({generation:'transfer-'+token,revision:0}).get(key))?.data;}
  return {head,view,commit,transact,initialize,stageRestore,publishRestore,putTransfer,readTransfer,environment,botId};
}
/** Adapter: existing catalog/service API remains unchanged; no second catalog. */
export function catalogRepository(store, legacy) {
  return {
    async read(){let h=await store.head();if(!h){const old=await legacy.read();if(!old)return null;h=await store.initialize(old.state,{legacyRevision:old.revision});}if(Number.isSafeInteger(h.meta.legacyRevision)){const old=await legacy.read();if(old&&old.revision!==h.meta.legacyRevision)fail('Старая база изменилась после переноса. Остановите старую версию и согласуйте данные; автоматическое затирание запрещено.','LEGACY_CHANGED');}const a=await store.view(h).get('admin');return {id:'application',revision:a.revision,state:a.data};},
    async initialize(state){await store.initialize(state);return this.read();},
    async compareSwap(revision,state){
      return store.transact(async v=>{const a=await v.get('admin');if(a.revision!==revision)return {value:null};
        const saved={id:'application',revision:v.head.revision+1,state:clone(state)};
        return {changes:[{key:'admin',kind:'admin',data:state}],value:saved};
      });
    }
  };
}
