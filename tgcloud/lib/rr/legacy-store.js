import { db } from 'sdk';
import { eq, and } from 'sdk/db';
import { rrAdminState } from './schema.js';
const KEY = 'application';
export const repository = {
  async read() {
    const row = await db.select().from(rrAdminState).where(eq(rrAdminState.id, KEY)).get();
    return row || null;
  },
  async initialize(state) {
    // In a race, update only the existing primary key to itself, NEVER reset state.
    const rows = await db.insert(rrAdminState).values({ id: KEY, revision: 1, state })
      .onConflictDoUpdate({ target: rrAdminState.id, set: { id: KEY } }).returning().run();
    return rows[0];
  },
  async compareSwap(revision, state) {
    const rows = await db.update(rrAdminState).set({ revision: revision + 1, state })
      .where(and(eq(rrAdminState.id, KEY), eq(rrAdminState.revision, revision)))
      .returning().run();
    return rows[0] || null;
  }
};
