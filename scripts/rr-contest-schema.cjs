'use strict';
const BEGIN='// BEGIN RR CONTEST RECORDS 1',END='// END RR CONTEST RECORDS 1';
const block=`${BEGIN}
import { table as rrRecordsTable, text as rrRecordsText, integer as rrRecordsInteger, index as rrRecordsIndex } from 'sdk/db';
export const rrRecords = rrRecordsTable('rr_records', {
  rowId: rrRecordsText('row_id').primaryKey(),
  generation: rrRecordsText('generation').notNull(),
  entityKey: rrRecordsText('entity_key').notNull(),
  kind: rrRecordsText('kind').notNull(),
  revision: rrRecordsInteger('revision').notNull(),
  payload: rrRecordsText('payload').notNull()
}, t => ({
  lookup: rrRecordsIndex('rr_records_lookup').on(t.generation,t.entityKey,t.revision),
  heads: rrRecordsIndex('rr_records_head').on(t.kind,t.revision)
}));
${END}`;
function ensureContestSchema(s){
 const begins=s.split(BEGIN).length-1,ends=s.split(END).length-1;
 if(begins||ends){if(begins!==1||ends!==1)throw new Error('Повреждены маркеры конкурсной схемы.');const a=s.indexOf(BEGIN),b=s.indexOf(END)+END.length;if(s.slice(a,b).replace(/\r\n/g,'\n')!==block)throw new Error('Схема конкурса изменена вручную; требуется явная миграция.');return s;}
 if(/\brrRecords\s*=/.test(s))throw new Error('Конфликт определения rrRecords.');return s.trimEnd()+'\n\n'+block+'\n';
}
function removeContestSchema(s){ if(!s.includes(BEGIN)&&!s.includes(END))return s;ensureContestSchema(s);const a=s.indexOf(BEGIN),b=s.indexOf(END)+END.length;return (s.slice(0,a)+s.slice(b)).trimEnd()+'\n';}
module.exports={ensureContestSchema,removeContestSchema,block};
