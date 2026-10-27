// Этап 0: таблиц нет. Файл оставлен для будущей серверной части.
// Без отдельного одобрения владельца не вводить базу/миграции.
export {};

// BEGIN RR ADMIN SCHEMA (managed by rr-prepare.cjs)
import {
  table as rrSchemaTable,
  text as rrSchemaText,
  integer as rrSchemaInteger,
  json as rrSchemaJson
} from 'sdk/db';

export const rrAdminState = rrSchemaTable('rr_admin_state', {
  id: rrSchemaText('id').primaryKey(),
  revision: rrSchemaInteger('revision').notNull(),
  state: rrSchemaJson('state_json').notNull()
});
// END RR ADMIN SCHEMA

// BEGIN RR CONTEST RECORDS 1
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
// END RR CONTEST RECORDS 1
