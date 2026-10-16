#!/usr/bin/env node
// Prueba de validate.mjs: el fixture debe fallar con cada caso y data/ debe pasar.
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const run = (...args) => spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'validate.mjs'), ...args], { cwd: ROOT, encoding: 'utf8', env: { ...process.env, BRANCH: '', CF_PAGES_BRANCH: '' } });

const EXPECTED = ['SAFELINKS', 'DUPLICATE_URL', 'MISSING_FIELD', 'INVALID_DATE', 'BROKEN_INTERNAL_LINK', 'SECOND_PERSON', 'POR_VERIFICAR_MAIN', 'PHONE'];
let ok = true;

const bad = run('--data', 'fixtures/validate-invalid', '--branch', 'main');
if (bad.status === 0) {
  console.error('✗ el fixture inválido pasó la validación');
  ok = false;
}
for (const code of EXPECTED) {
  const hit = bad.stderr.includes(`[${code}]`);
  console.log(`${hit ? '✓' : '✗'} detecta ${code}`);
  ok &&= hit;
}

const good = run('--data', 'data');
console.log(`${good.status === 0 ? '✓' : '✗'} data/ pasa fuera de main`);
ok &&= good.status === 0;

const mainBlocked = run('--data', 'data', '--branch', 'main');
console.log(`${mainBlocked.status !== 0 ? '✓' : '✗'} data/ con [POR VERIFICAR] se bloquea en main`);
ok &&= mainBlocked.status !== 0;

if (!ok) process.exit(1);
console.log('test-validate: OK');
