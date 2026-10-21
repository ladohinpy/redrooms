import { invoke } from '../lib/rr/runtime.js';
export default async function rrHealth(input, ctx) { return await invoke('health', input, ctx); }
