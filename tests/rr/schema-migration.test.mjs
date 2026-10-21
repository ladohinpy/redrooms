import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { legacyFixture } from './helpers.mjs';
const require = createRequire(import.meta.url);
const { ensureStandaloneSchema } = require('../../scripts/rr-prepare.cjs');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const legacy = "// Existing empty schema\n\n// Red Room administration: additive table; data is never reset by deployment.\nexport { rrAdminState } from './lib/rr/schema.js';\n";
const sdkSource = `
  function column(name, type) {
    return { name, type, primaryKey() { this.pk = true; return this; }, notNull() { this.required = true; return this; } };
  }
  export const text = name => column(name, 'text');
  export const integer = name => column(name, 'integer');
  export const json = name => column(name, 'json');
  export const table = (name, columns) => ({ name, columns });
`;
const dataUrl = source => 'data:text/javascript;base64,' + Buffer.from(source).toString('base64');
// Local ESM check, NOT Telegram integration: supply only sdk/db, never any lib/*.
async function isolatedSchema(source) {
  const rewritten = source.replace(/(['"])sdk\/db\1/g, JSON.stringify(dataUrl(sdkSource)));
  return import(dataUrl(rewritten));
}

test('schema fix: empty schema gets a direct table declaration, not a project import', () => {
  const source = ensureStandaloneSchema('');
  assert.match(source, /export const rrAdminState = rrSchemaTable/);
  assert.ok(!source.includes('./lib/rr/schema.js'));
  assert.deepEqual([...source.matchAll(/from\s+['"]([^'"]+)['"]/g)].map(m => m[1]), ['sdk/db']);
});
test('schema fix: removes the exact legacy generated export and preserves owner content', () => {
  const owner = "import { table, text } from 'sdk/db';\nexport const ownerTable = table('owner_table', { id: text('id').primaryKey() });\n";
  const source = ensureStandaloneSchema(owner + legacy);
  assert.ok(source.includes(owner.trim()));
  assert.ok(source.includes('// Existing empty schema'));
  assert.ok(!source.includes('./lib/rr/schema.js'));
});
test('schema fix: repeated preparation is byte-for-byte stable', () => {
  const first = ensureStandaloneSchema(legacy);
  assert.equal(ensureStandaloneSchema(first), first);
});
test('schema fix: CRLF and double-quoted legacy export are supported', () => {
  const source = ensureStandaloneSchema('export { rrAdminState } from "./lib/rr/schema.js";\r\n');
  assert.ok(source.includes('rrSchemaTable'));
  assert.ok(!source.includes('./lib/rr/schema.js'));
  const crlf = source.replace(/\n/g, '\r\n');
  assert.equal(ensureStandaloneSchema(crlf), source);
});
test('schema fix: a custom rrAdminState declaration is not overwritten', () => {
  assert.throws(() => ensureStandaloneSchema('export const rrAdminState = customDefinition();'), /нестандартное/);
});
test('schema fix: duplicate legacy exports fail closed', () => {
  assert.throws(() => ensureStandaloneSchema(legacy + legacy), /Несколько/);
});
test('schema fix: partial and duplicate managed markers fail closed', () => {
  const source = ensureStandaloneSchema('');
  assert.throws(() => ensureStandaloneSchema(source.replace('// END RR ADMIN SCHEMA', '')), /маркеры/);
  assert.throws(() => ensureStandaloneSchema(source + source), /маркеры/);
});
test('schema fix: hand-edited managed columns are never silently reset', () => {
  const edited = ensureStandaloneSchema('').replace("'state_json'", "'custom_state'");
  assert.throws(() => ensureStandaloneSchema(edited), /изменён вручную/);
});
test('schema fix: mixed old and new forms fail closed', () => {
  assert.throws(() => ensureStandaloneSchema(ensureStandaloneSchema('') + legacy), /Смешаны/);
});
test('schema fix: isolated local evaluation rejects the old dependency and accepts the new table', async () => {
  await assert.rejects(() => isolatedSchema(legacy));
  const { rrAdminState } = await isolatedSchema(ensureStandaloneSchema(legacy));
  assert.equal(rrAdminState.name, 'rr_admin_state');
  assert.deepEqual(Object.keys(rrAdminState.columns), ['id', 'revision', 'state']);
  assert.equal(rrAdminState.columns.id.name, 'id');
  assert.equal(rrAdminState.columns.id.pk, true);
  assert.equal(rrAdminState.columns.revision.name, 'revision');
  assert.equal(rrAdminState.columns.revision.type, 'integer');
  assert.equal(rrAdminState.columns.revision.required, true);
  assert.equal(rrAdminState.columns.state.name, 'state_json');
  assert.equal(rrAdminState.columns.state.type, 'json');
  assert.equal(rrAdminState.columns.state.required, true);
});
test('schema fix: unrelated SDK table uses its own names without collisions', async () => {
  const owner = "import { table, text } from 'sdk/db';\nexport const ownerTable = table('owner_table', { id: text('id').primaryKey() });\n";
  const result = await isolatedSchema(ensureStandaloneSchema(owner + legacy));
  assert.equal(result.ownerTable.name, 'owner_table');
  assert.equal(result.rrAdminState.name, 'rr_admin_state');
});
test('schema fix: runtime compatibility module points TO root schema, not vice versa', () => {
  const source = fs.readFileSync(path.join(root, 'tgcloud/lib/rr/schema.js'), 'utf8');
  assert.match(source, /export\s*\{\s*rrAdminState\s*\}\s*from\s*['"]\.\.\/\.\.\/schema\.js['"]/);
  assert.ok(!source.includes("table('rr_admin_state'"));
});
test('schema fix: actual prepare repairs the legacy root and cannot reintroduce it on next build', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rr-schema-fix-'));
  const write = (name, value) => {
    const p = path.join(dir, name); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, value);
  };
  try {
    for (const p of ['src/rr', 'scripts', 'tgcloud/lib/rr', 'tgcloud/endpoints', 'config', 'public/admin.html', 'public/rr/admin.css']) {
      fs.cpSync(path.join(root, p), path.join(dir, p), { recursive: true });
    }
    for (const p of ['config/rr-built-games.json', 'config/rr-admins.local.json']) fs.rmSync(path.join(dir, p), { force: true });
    write('config/rr-game-builds.json', JSON.stringify({ schemaVersion: 1, games: [{ id: 'v06', name: 'Fixture', source: 'src/rr-legacy-v06.html', adapter: 'v06', aliases: ['v1'] }] }));
    write('public/index.html', legacyFixture());
    write('public/access-gate.js', '// local test only');
    write('tgcloud/endpoints/checkAccess.js', 'export default async () => ({ allowed: true });');
    write('tgcloud/schema.js', legacy);
    write('tgcloud.jsonc', JSON.stringify({ static: { source: 'public', spa: false } }));
    write('package.json', JSON.stringify({ name: 'schema-fix-fixture', scripts: {} }));
    const command = () => spawnSync(process.execPath, ['scripts/rr-prepare.cjs'], { cwd: dir, env: { ...process.env, RR_ADMIN_IDS: '' }, encoding: 'utf8' });
    const first = command(); assert.equal(first.status, 0, first.stderr);
    const schema = fs.readFileSync(path.join(dir, 'tgcloud/schema.js'), 'utf8');
    assert.ok(!schema.includes('./lib/rr/schema.js'));
    const builds = fs.readFileSync(path.join(dir, 'config/rr-built-games.json'), 'utf8');
    const second = command(); assert.equal(second.status, 0, second.stderr);
    assert.equal(fs.readFileSync(path.join(dir, 'tgcloud/schema.js'), 'utf8'), schema);
    assert.equal(fs.readFileSync(path.join(dir, 'config/rr-built-games.json'), 'utf8'), builds);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
