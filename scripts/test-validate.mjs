#!/usr/bin/env node
// Prueba de validate.mjs y check-dist.mjs: los fixtures deben fallar con cada caso y data/ debe pasar.
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const env = { ...process.env, BRANCH: '', CF_PAGES_BRANCH: '' };
const run = (script, ...args) => spawnSync(process.execPath, [path.join(ROOT, 'scripts', script), ...args], { cwd: ROOT, encoding: 'utf8', env });
let ok = true;
const check = (cond, label) => {
  console.log(`${cond ? '✓' : '✗'} ${label}`);
  ok &&= cond;
};

const bad = run('validate.mjs', '--data', 'fixtures/validate-invalid', '--branch', 'main');
check(bad.status !== 0, 'el fixture de datos inválido no pasa validate');
for (const code of ['SAFELINKS', 'DUPLICATE_URL', 'MISSING_FIELD', 'INVALID_DATE', 'BROKEN_INTERNAL_LINK', 'SECOND_PERSON', 'POR_VERIFICAR_MAIN', 'PHONE', 'MONEY', 'PRIVATE_LINK']) {
  check(bad.stderr.includes(`[${code}]`), `validate detecta ${code}`);
}

const badDist = run('check-dist.mjs', '--dist', 'fixtures/dist-invalid');
check(badDist.status !== 0, 'el fixture de dist inválido no pasa check-dist');
for (const code of ['REDES_IN_TABLE', 'PHONE', 'MONEY', 'SECOND_PERSON', 'INLINE_STYLE']) {
  check(badDist.stderr.includes(`[${code}]`), `check-dist detecta ${code}`);
}

check(run('validate.mjs', '--data', 'data').status === 0, 'data/ pasa fuera de main');
check(run('validate.mjs', '--data', 'data', '--branch', 'main').status === 0, 'data/ aprobada pasa en main (decisiones del 18-oct-2026)');

if (!ok) process.exit(1);
console.log('test-validate: OK');
