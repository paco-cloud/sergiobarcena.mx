#!/usr/bin/env node
// Revisa el HTML generado (SBJ-CODE-02 §5.3 y §9): nada privado ni prohibido llega a dist/.
// Uso: node scripts/check-dist.mjs [--dist <dir>]
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const i = argv.indexOf('--dist');
const DIST = path.resolve(ROOT, i >= 0 ? argv[i + 1] : 'dist');
const errors = [];

const files = [];
const walk = async (dir) => {
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) await walk(p);
    else if (e.name.endsWith('.html')) files.push(p);
  }
};
await walk(DIST);

// Titulares y títulos se citan tal cual (data-verbatim): no se revisa su persona gramatical.
const visibleText = (html) =>
  html
    .replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<([a-z0-9]+)[^>]*\sdata-verbatim[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&[a-z#0-9]+;/gi, ' ');

const RULES = [
  ['PHONE', /\+\s?52\b|\(\s*55\s*\)|(?<![\w.\/=-])55[\s.-]?\d{4}[\s.-]?\d{4}(?!\w)/, 'all'],
  ['MONEY', /\$\s?\d|\bUSD\b|\bMXN\b/, 'all'],
  ['SAFELINKS', /safelinks\.protection\.outlook\.com/i, 'all'],
  ['PRIVATE_LINK', /drive\.google|docs\.google/i, 'all'],
  ['PRIVATE_EMAIL', /sergio\.barcena@tec\.mx/i, 'all'],
  ['SECOND_PERSON', /(^|[^\p{L}])(tu|tus|te|ti|contigo)(?![\p{L}])/iu, 'text'],
];

for (const file of files) {
  const rel = path.relative(DIST, file);
  const html = await readFile(file, 'utf8');
  const text = visibleText(html);
  for (const [code, re, scope] of RULES) {
    const m = (scope === 'text' ? text : html).match(re);
    if (m) {
      const at = m.index ?? 0;
      const src = scope === 'text' ? text : html;
      errors.push(`[${code}] ${rel}: «${src.slice(Math.max(0, at - 40), at + 40).replace(/\s+/g, ' ').trim()}»`);
    }
  }
  // Las publicaciones en redes van en su propio bloque, nunca en la tabla de prensa.
  if (/class="trow prensa"[^>]*data-kind="redes"/.test(html)) errors.push(`[REDES_IN_TABLE] ${rel}: hay una nota kind:"redes" dentro de la tabla de prensa`);
  // CSP estricta: sin estilos ni manejadores en línea.
  if (/\sstyle="/.test(html)) errors.push(`[INLINE_STYLE] ${rel}: atributo style en línea (lo bloquea la CSP)`);
  if (/\son[a-z]+="/.test(html)) errors.push(`[INLINE_HANDLER] ${rel}: manejador de evento en línea (lo bloquea la CSP)`);
}

if (errors.length) {
  console.error(errors.join('\n'));
  console.error(`check-dist: ${errors.length} errores`);
  process.exit(1);
}
console.log(`check-dist: OK · ${files.length} páginas sin teléfonos, montos, safelinks, Drive, correo privado ni segunda persona · 0 errores, 0 avisos`);
