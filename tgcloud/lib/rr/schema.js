import { table, text, integer, json } from 'sdk/db';
// A single atomic aggregate for this two-administrator MVP. See ARCHITECTURE.md.
// Do not use unsupported foreign keys or assume cross-call transactions.
export const rrAdminState = table('rr_admin_state', {
  id: text('id').primaryKey(),
  revision: integer('revision').notNull(),
  state: json('state_json').notNull()
});
