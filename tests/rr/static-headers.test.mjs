import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { legacyFixture } from './helpers.mjs';
const require = createRequire(import.meta.url);
const { parseJSONC, validateStaticHeaders } = require('../../scripts/rr-prepare.cjs');
const root = fileURLToPath(new URL('../../', import.meta.url));
const blocked = { path: '/*', set: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' } };
const allowed = { path: '/*', set: { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' } };
const config = headers => ({ static: { source: 'public', spa: false, headers } });
const write = (dir, name, text) => { const p = path.join(dir, name); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, text); };
function fixture(headers = [blocked]) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rr-static-headers-'));
  for (const name of ['src/rr', 'scripts', 'tgcloud/lib/rr', 'tgcloud/endpoints', 'public/admin.html', 'public/rr/admin.css']) {
    fs.cpSync(path.join(root, name), path.join(dir, name), { recursive: true });
  }
  write(dir, 'config/rr-game-builds.json', JSON.stringify({ schemaVersion: 1, games: [{ id: 'v06', name: 'Fixture', source: 'src/rr-legacy-v06.html', adapter: 'v06', aliases: ['v1'] }] }));
  write(dir, 'public/index.html', legacyFixture());
  write(dir, 'public/access-gate.js', '// LOCAL TEST FIXTURE ONLY\n');
  write(dir, 'tgcloud/schema.js', '// fixture\n');
  write(dir, 'tgcloud.jsonc', JSON.stringify({ ...config(headers), ownerField: 'keep', static: { ...config(headers).static, redirects: [{ from: '/old', to: '/new', status: 301 }] } }));
  return dir;
}
const run = (dir, file) => spawnSync(process.execPath, [path.join(dir, file)], { cwd: dir, env: { ...process.env, RR_ADMIN_IDS: '' }, encoding: 'utf8' });
const cleanup = dir => fs.rmSync(dir, { recursive: true, force: true });
const readConfig = dir => parseJSONC(fs.readFileSync(path.join(dir, 'tgcloud.jsonc'), 'utf8'));

test('static headers: known bad config from the cloud log is rejected locally', () => {
  assert.throws(() => validateStaticHeaders(config([blocked])), /X-Content-Type-Options/);
});
test('static headers: the corrected managed rule passes the local guard without mutation', () => {
  const c = config([allowed]); const before = structuredClone(c);
  validateStaticHeaders(c); assert.deepEqual(c, before);
});
for (const name of ['x-content-type-options', 'X-CONTENT-TYPE-OPTIONS', 'X-Content-Type-Options']) {
  test('static headers: case-insensitive check for ' + name, () => {
    assert.throws(() => validateStaticHeaders(config([{ path: '/admin.html', set: { [name]: 'nosniff' } }])), /static.headers\[0\]/);
  });
}
test('static headers: setting the forbidden name to null is not a workaround', () => {
  assert.throws(() => validateStaticHeaders(config([{ path: '/*', set: { 'X-Content-Type-Options': null } }])), /не заменяйте его на null/);
});
test('static headers: any retained path is checked, not just the catch-all', () => {
  assert.throws(() => validateStaticHeaders(config([allowed, { ...blocked, path: '/rr/*' }])), /static.headers\[1\]/);
});
test('static headers: omitted headers and an empty array are supported', () => {
  validateStaticHeaders({ static: { source: 'public' } }); validateStaticHeaders(config([]));
});
test('static headers: malformed header arrays/rules fail locally', () => {
  for (const headers of [false, null, {}, 'text', [null], [false], [[]], [{ path: '/*' }], [{ path: '/*', set: [] }]]) {
    assert.throws(() => validateStaticHeaders(config(headers)), /static.headers/);
  }
});
test('static headers: unrelated header values are not silently deleted or rewritten', () => {
  const c = config([{ path: '/old', set: { 'Referrer-Policy': null, 'Cache-Control': 'no-cache' } }]);
  const before = structuredClone(c); validateStaticHeaders(c); assert.deepEqual(c, before);
});
test('static headers: actual prepare removes old managed header and preserves code/settings', () => {
  const dir = fixture();
  try {
    const game = fs.readFileSync(path.join(dir, 'public/index.html'), 'utf8');
    const result = run(dir, 'scripts/rr-prepare.cjs'); assert.equal(result.status, 0, result.stderr);
    const c = readConfig(dir); assert.deepEqual(c.static.headers, [allowed]);
    assert.equal(c.ownerField, 'keep'); assert.deepEqual(c.static.redirects, [{ from: '/old', to: '/new', status: 301 }]);
    assert.equal(fs.readFileSync(path.join(dir, 'src/rr-legacy-v06.html'), 'utf8'), game);
    validateStaticHeaders(c);
  } finally { cleanup(dir); }
});
test('static headers: repeated prepare cannot reintroduce the blocked header or change game hashes', () => {
  const dir = fixture();
  try {
    assert.equal(run(dir, 'scripts/rr-prepare.cjs').status, 0);
    const first = fs.readFileSync(path.join(dir, 'tgcloud.jsonc'), 'utf8');
    const manifest = fs.readFileSync(path.join(dir, 'config/rr-built-games.json'), 'utf8');
    assert.equal(run(dir, 'scripts/rr-prepare.cjs').status, 0);
    assert.equal(fs.readFileSync(path.join(dir, 'tgcloud.jsonc'), 'utf8'), first);
    assert.equal(fs.readFileSync(path.join(dir, 'config/rr-built-games.json'), 'utf8'), manifest);
  } finally { cleanup(dir); }
});
test('static headers: retained incompatible path stops preparation BEFORE any writes', () => {
  const dir = fixture([blocked, { ...blocked, path: '/rr/*' }]);
  try {
    const watched = ['public/index.html', 'tgcloud.jsonc', 'tgcloud/schema.js'];
    const before = watched.map(n => fs.readFileSync(path.join(dir, n), 'utf8'));
    const result = run(dir, 'scripts/rr-prepare.cjs'); assert.notEqual(result.status, 0); assert.match(result.stderr, /X-Content-Type-Options/);
    assert.deepEqual(watched.map(n => fs.readFileSync(path.join(dir, n), 'utf8')), before);
    assert.ok(!fs.existsSync(path.join(dir, 'src/rr-legacy-v06.html')));
  } finally { cleanup(dir); }
});
test('static headers: the standalone check stops early on forbidden project config', () => {
  const dir = fixture();
  try {
    const result = run(dir, 'scripts/rr-check.cjs');
    assert.notEqual(result.status, 0); assert.match(result.stderr, /STATIC CONFIG FAILED/);
    assert.doesNotMatch(result.stdout, /TAP version/);
  } finally { cleanup(dir); }
});
test('static headers: deploy still checks the prepared project before the first cloud call', () => {
  const source = fs.readFileSync(path.join(root, 'scripts/rr-deploy.cjs'), 'utf8');
  assert.ok(source.indexOf("node('scripts/rr-check.cjs')") < source.indexOf("cloud(['fetch'])"));
});
