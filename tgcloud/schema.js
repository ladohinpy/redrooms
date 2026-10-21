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
