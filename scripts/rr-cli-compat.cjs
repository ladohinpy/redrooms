#!/usr/bin/env node
/** Narrow, idempotent compatibility patch in the installed CLI, NOT in cloud modules. */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { spawnSync } = require('node:child_process');
const MARKER = '// RR-CLI-RESPONSE-FIX-1';
const ANCHOR = '      if (response?.canonical_modules) {\n        replaceSnapshot(response.canonical_modules);\n      }';

function patchDeploySource(source, helperUrl) {
  if (typeof source !== 'string') throw new Error('CLI deploy source is not text.');
  const normalized = source.replace(/\r\n/g, '\n');
  const injection = `      ${MARKER}\n      const { normalizeDeployResponse } = await import(${JSON.stringify(helperUrl)});\n      response = await normalizeDeployResponse(\n        response,\n        () => retryOnAuthError(async () => getFiles(await resolveToken())),\n        { expectedManifest: manifest, notice: message => console.warn(message) }\n      );\n`;
  if (normalized.includes(MARKER)) {
    if (!normalized.includes(injection + ANCHOR) || normalized.split(MARKER).length !== 2) {
      throw new Error('Installed CLI contains a different compatibility patch. Reinstall the pinned CLI; do not force publication.');
    }
    return source;
  }
  if (normalized.split(ANCHOR).length !== 2) throw new Error('CLI 0.2.0 deploy contract does not match; no files were changed.');
  for (const name of ['getFiles', 'resolveToken', 'retryOnAuthError']) {
    if (!normalized.includes(name)) throw new Error('CLI is missing ' + name + '; no files were changed.');
  }
  if (!normalized.includes('const manifest =')) throw new Error('CLI manifest contract does not match.');
  return normalized.replace(ANCHOR, injection + ANCHOR);
}

function installCliResponseFix(root = path.resolve(__dirname, '..')) {
  const cliDir = path.join(root, 'node_modules/@tgcloud/cli');
  const pkg = JSON.parse(fs.readFileSync(path.join(cliDir, 'package.json'), 'utf8'));
  if (pkg.version !== '0.2.0') throw new Error('Compatibility fix supports only @tgcloud/cli 0.2.0; found ' + pkg.version);
  const helper = path.join(root, 'scripts/rr-cli-response.mjs');
  fs.accessSync(helper);
  const target = path.join(cliDir, 'src/commands/deploy.js');
  const source = fs.readFileSync(target, 'utf8');
  const result = patchDeploySource(source, pathToFileURL(helper).href);
  if (result === source) return false;
  // Check syntax BEFORE replacing the installed dependency. All other CLI files,
  // token resolution, optimistic concurrency and migration guards are untouched.
  const temporary = target + '.rr-check.mjs';
  try {
    fs.writeFileSync(temporary, result, { flag: 'wx' });
    const check = spawnSync(process.execPath, ['--check', temporary], { encoding: 'utf8' });
    if (check.status !== 0) throw new Error('Patched CLI syntax check failed: ' + (check.stderr || check.error?.message || 'unknown error'));
    fs.renameSync(temporary, target);
  } finally {
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
  }
  return true;
}
if (require.main === module) {
  try { console.log(installCliResponseFix() ? 'CLI response compatibility fix installed.' : 'CLI response compatibility fix already installed.'); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
module.exports = { patchDeploySource, installCliResponseFix, MARKER, ANCHOR };
