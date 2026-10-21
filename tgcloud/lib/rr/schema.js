// Compatibility export for store.js and previously deployed modules.
// Define the table only in the root schema. Never make root schema depend
// on this library: migrations must be able to evaluate root schema alone.
export { rrAdminState } from '../../schema.js';
