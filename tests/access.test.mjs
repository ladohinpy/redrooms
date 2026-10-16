import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { membershipDecision } from '../tgcloud/lib/subscription.js';

const cases = [
  [{ status: 'member' }, 'allowed'],
  [{ status: 'administrator' }, 'allowed'],
  [{ status: 'creator' }, 'allowed'],
  [{ status: 'restricted', is_member: true }, 'allowed'],
  [{ status: 'restricted', is_member: false }, 'denied'],
  [{ status: 'left' }, 'denied'],
  [{ status: 'kicked' }, 'denied'],
  [{ status: 'other' }, 'error'],
  [{}, 'error'],
  [null, 'error'],
];
for (const [member, expected] of cases) {
  assert.equal(membershipDecision(member), expected, `getChatMember: ${JSON.stringify(member)}`);
}
console.log('OK: membershipDecision correctly handles 10 Bot API statuses.');

const script = readFileSync(new URL('../public/access-gate.js', import.meta.url), 'utf8');
function setup({ initData = 'valid-init-data', call } = {}) {
  const root = {
    Telegram: { WebApp: { initData, Serverless: call ? { call } : undefined } },
    setTimeout, clearTimeout,
  };
  vm.runInNewContext(script, { window: root });
  return root.RedRoomAccess;
}

assert.equal((await setup({ call: null }).verify()).kind, 'unavailable');
assert.equal((await setup({ initData: '', call() {} }).verify()).kind, 'unavailable');
assert.equal((await setup({ call(name, input, cb) { assert.equal(name, 'checkAccess'); assert.equal(Object.keys(input).length, 0); cb(null, { allowed: true }); } }).verify()).kind, 'allowed');
assert.equal((await setup({ call(_n, _i, cb) { cb(null, { allowed: false }); } }).verify()).kind, 'denied');
assert.equal((await setup({ call(_n, _i, cb) { cb(null, { allowed: 'true' }); } }).verify()).kind, 'error');
assert.equal((await setup({ call(_n, _i, cb) { cb({ type: 'UNAUTHORIZED', message: 'Invalid data' }, null); } }).verify()).kind, 'error');
assert.equal((await setup({ call() { throw Error('failed'); } }).verify()).kind, 'error');
console.log('OK: browser adapter fail-closed, no initData bypass, correct Serverless.call results.');
