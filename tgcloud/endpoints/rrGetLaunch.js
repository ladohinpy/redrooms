import { invoke } from '../lib/rr/runtime.js';
export default async function (input, ctx) { return await invoke('launch', input, ctx); }
