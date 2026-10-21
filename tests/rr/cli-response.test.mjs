import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { normalizeDeployResponse } from '../../scripts/rr-cli-response.mjs';
const require = createRequire(import.meta.url);
const { patchDeploySource, installCliResponseFix, ANCHOR, MARKER } = require('../../scripts/rr-cli-compat.cjs');
const root = fileURLToPath(new URL('../../', import.meta.url));
const helperUrl = new URL('../../scripts/rr-cli-response.mjs', import.meta.url).href;
const sourceMap = { schema: 'export {};', 'lib/rr/schema': 'export const table = 1;' };
const manifest = Object.keys(sourceMap);
const bad = () => ({ revision: 3, canonical_modules: { schema: 'export {};', 'lib/rr/schema': false }, db_changes: [{ table: 'rr_admin_state' }], static: { hash: 'unchanged' } });
const good = () => ({ revision: 3, canonical_modules: { ...sourceMap } });
const options = { expectedManifest: manifest };
const unreachable = async () => { throw new Error('Unexpected network request'); };

// Minimal fixture of the documented 0.2.0 response-handling contract, not a
// substitute for executing the real CLI against Telegram. No token or network.
const fixture = `import fs from 'node:fs';
const getFiles = async () => JSON.parse(process.env.FULL_RESPONSE);
const resolveToken = async () => 'test-only-token';
const retryOnAuthError = async fn => fn();
function replaceSnapshot(map) {
  for (const [name, source] of Object.entries(map)) {
    fs.writeFileSync(name.replaceAll('/', '_') + '.js', source);
  }
}
let response = JSON.parse(process.env.DEPLOY_RESPONSE);
const manifest = JSON.parse(process.env.EXPECTED_MANIFEST);
${ANCHOR}
`;

for (const value of [undefined, null, {}, { revision: 3 }, { canonical_modules: null }]) {
  test('CLI guard: no modules section is preserved: ' + JSON.stringify(value), async () => {
    assert.equal(await normalizeDeployResponse(value, unreachable, options), value);
  });
}
test('CLI guard: ordinary string map and response identity stay unchanged', async () => {
  const response = good();
  assert.equal(await normalizeDeployResponse(response, unreachable, options), response);
});
test('CLI guard: false triggers ONE read, same revision, full module set; no mutation', async () => {
  const response = bad(); const copy = structuredClone(response); let reads = 0;
  const fresh = good(); const notices = [];
  const result = await normalizeDeployResponse(response, async () => { reads++; return fresh; }, { ...options, notice: text => notices.push(text) });
  assert.equal(reads, 1); assert.equal(notices.length, 1);
  assert.deepEqual(result.canonical_modules, sourceMap);
  assert.deepEqual(response, copy);
  assert.notEqual(result.canonical_modules, fresh.canonical_modules);
  assert.equal(result.revision, 3);
  assert.equal(result.db_changes, response.db_changes);
  assert.equal(result.static, response.static);
});
for (const value of [true, 7, {}, [], null]) {
  test('CLI guard: unknown source type fails closed: ' + JSON.stringify(value), async () => {
    const response = bad(); response.canonical_modules.schema = value;
    await assert.rejects(normalizeDeployResponse(response, unreachable, options), /Неизвестный тип/);
  });
}
for (const value of [false, [], 'text']) {
  test('CLI guard: invalid map rejected: ' + JSON.stringify(value), async () => {
    await assert.rejects(normalizeDeployResponse({ revision: 3, canonical_modules: value }, unreachable, options), /не является объектом/);
  });
}
for (const value of [undefined, null, '3', -1, 3.5]) {
  test('CLI guard: no unversioned recovery: ' + JSON.stringify(value), async () => {
    const response = bad(); response.revision = value;
    await assert.rejects(normalizeDeployResponse(response, unreachable, options), /ревизии ответа/);
  });
}
for (const value of [2, 4, undefined, '3']) {
  test('CLI guard: concurrent or unknown revision stops: ' + JSON.stringify(value), async () => {
    await assert.rejects(normalizeDeployResponse(bad(), async () => ({ ...good(), revision: value }), options), /ревизия изменилась/);
  });
}
test('CLI guard: GET failure cannot become success; raw token/error is not leaked', async () => {
  await assert.rejects(normalizeDeployResponse(bad(), async () => { throw new Error('secret-token=123'); }, options), err => {
    assert.match(err.message, /Не удалось прочитать/); assert.doesNotMatch(err.message, /secret-token/); return true;
  });
});
test('CLI guard: a second false is not stringified or silently ignored', async () => {
  await assert.rejects(normalizeDeployResponse(bad(), async () => bad(), options), /текст всех модулей/);
});
test('CLI guard: missing remote module stops', async () => {
  await assert.rejects(normalizeDeployResponse(bad(), async () => ({ revision: 3, canonical_modules: { schema: sourceMap.schema } }), options), /не совпадает с manifest/);
});
test('CLI guard: extra remote module stops', async () => {
  await assert.rejects(normalizeDeployResponse(bad(), async () => ({ revision: 3, canonical_modules: { ...sourceMap, extra: 'code' } }), options), /не совпадает с manifest/);
});
test('CLI guard: invalid manifest stops', async () => {
  await assert.rejects(normalizeDeployResponse(bad(), good, { expectedManifest: ['schema', 'schema'] }), /Неправильный manifest/);
});
test('CLI guard: empty source is legitimate text', async () => {
  const result = await normalizeDeployResponse(bad(), async () => ({ revision: 3, canonical_modules: { schema: '', 'lib/rr/schema': '' } }), options);
  assert.equal(result.canonical_modules.schema, '');
});
test('CLI guard: static-only response recovery preserves named modules', async () => {
  assert.deepEqual((await normalizeDeployResponse(bad(), good)).canonical_modules, sourceMap);
  await assert.rejects(normalizeDeployResponse(bad(), async () => ({ revision: 3, canonical_modules: {} })), /отсутствует модуль/);
});
test('CLI patch: precise anchor, no effect outside response handling, idempotent', () => {
  const patched = patchDeploySource(fixture, helperUrl);
  assert.equal(patchDeploySource(patched, helperUrl), patched);
  assert.equal(patched.split(MARKER).length - 1, 1);
  assert(patched.includes(ANCHOR));
  assert.doesNotMatch(patched, /--force|applyMigration|batchDeploy\(/);
});
test('CLI patch: refuses changed or repeated contract, no guessing', () => {
  assert.throws(() => patchDeploySource(fixture.replace(ANCHOR, ''), helperUrl), /does not match/);
  assert.throws(() => patchDeploySource(fixture + ANCHOR, helperUrl), /does not match/);
  assert.throws(() => patchDeploySource(fixture + '\n' + MARKER, helperUrl), /different compatibility patch/);
});
test('CLI patch: CRLF source and path with spaces are supported', () => {
  const patched = patchDeploySource(fixture.replaceAll('\n', '\r\n'), 'file:///C:/Project%20Room/scripts/rr-cli-response.mjs');
  assert(patched.includes('file:///C:/Project%20Room/scripts/rr-cli-response.mjs'));
});
test('CLI patch: installed dependency gets a syntax-checked fix, rejects other version', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rr-cli-install-'));
  try {
    const pkgDir = path.join(tmp, 'node_modules/@tgcloud/cli');
    fs.mkdirSync(path.join(pkgDir, 'src/commands'), { recursive: true });
    fs.mkdirSync(path.join(tmp, 'scripts'));
    fs.copyFileSync(path.join(root, 'scripts/rr-cli-response.mjs'), path.join(tmp, 'scripts/rr-cli-response.mjs'));
    fs.writeFileSync(path.join(pkgDir, 'package.json'), JSON.stringify({ version: '0.2.0', type: 'module' }));
    fs.writeFileSync(path.join(pkgDir, 'src/commands/deploy.js'), fixture);
    assert.equal(installCliResponseFix(tmp), true);
    assert.equal(installCliResponseFix(tmp), false);
    fs.writeFileSync(path.join(pkgDir, 'package.json'), JSON.stringify({ version: '0.3.0' }));
    assert.throws(() => installCliResponseFix(tmp), /only @tgcloud\/cli 0.2.0/);
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});
test('CLI fixture: reproduce false/writeFileSync error, then repair without redeploy', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rr-cli-reproduce-'));
  try {
    const file = path.join(tmp, 'contract.mjs');
    const env = { ...process.env, DEPLOY_RESPONSE: JSON.stringify(bad()), FULL_RESPONSE: JSON.stringify(good()), EXPECTED_MANIFEST: JSON.stringify(manifest) };
    fs.writeFileSync(file, fixture);
    let result = spawnSync(process.execPath, [file], { cwd: tmp, encoding: 'utf8', env });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /ERR_INVALID_ARG_TYPE/);
    assert.match(result.stderr, /boolean/);
    fs.writeFileSync(file, patchDeploySource(fixture, helperUrl));
    result = spawnSync(process.execPath, [file], { cwd: tmp, encoding: 'utf8', env });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(fs.readFileSync(path.join(tmp, 'lib_rr_schema.js'), 'utf8'), sourceMap['lib/rr/schema']);
    assert.equal(fs.readFileSync(path.join(tmp, 'schema.js'), 'utf8'), sourceMap.schema);
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});
test('CLI fixture: revision mismatch cannot overwrite any snapshot file', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rr-cli-race-'));
  try {
    fs.writeFileSync(path.join(tmp, 'schema.js'), 'old snapshot');
    const file = path.join(tmp, 'contract.mjs'); fs.writeFileSync(file, patchDeploySource(fixture, helperUrl));
    const result = spawnSync(process.execPath, [file], { cwd: tmp, encoding: 'utf8', env: { ...process.env, DEPLOY_RESPONSE: JSON.stringify(bad()), FULL_RESPONSE: JSON.stringify({ ...good(), revision: 4 }), EXPECTED_MANIFEST: JSON.stringify(manifest) } });
    assert.notEqual(result.status, 0);
    assert.equal(fs.readFileSync(path.join(tmp, 'schema.js'), 'utf8'), 'old snapshot');
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});
test('Deployment still uses fetch, dry-run, safe migration and health before frontend', () => {
  const source = fs.readFileSync(path.join(root, 'scripts/rr-deploy.cjs'), 'utf8');
  const marks = ["cloud(['fetch'])", "cloud(['push','tgcloud/schema.js'", "cloud(['migrate','--dry-run'])", "cloud(['migrate','--safe'])", "cloud(['run','endpoints/rrHealth'", "cloud(['push','public/'])"];
  for (let i = 1; i < marks.length; i++) assert(source.indexOf(marks[i]) > source.indexOf(marks[i-1]));
  assert.doesNotMatch(source, /cloud\(\[[^\]]*['"]--force['"]/);
});
