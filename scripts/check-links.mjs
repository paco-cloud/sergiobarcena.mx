#!/usr/bin/env node
// Revisa enlaces internos (href/src), anclas (#id), sitemap.xml y _redirects dentro de dist/.
import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(ROOT, 'dist');
const errors = [];

const files = [];
const walk = async (dir) => {
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) await walk(p);
    else files.push(p);
  }
};
try {
  await walk(DIST);
} catch {
  console.error('check-links: no existe dist/; corre primero scripts/build.mjs');
  process.exit(1);
}

const exists = async (p) => {
  try {
    return (await stat(p)).isFile();
  } catch {
    return false;
  }
};
// Resuelve una ruta pública como lo hace Cloudflare Pages.
const resolve = async (urlPath) => {
  const clean = decodeURIComponent(urlPath);
  const base = path.join(DIST, clean);
  const candidates = clean.endsWith('/') ? [path.join(base, 'index.html')] : [base, `${base}.html`, path.join(base, 'index.html')];
  for (const c of candidates) if (await exists(c)) return c;
  return null;
};
const idCache = new Map();
const idsOf = async (file) => {
  if (!idCache.has(file)) {
    const html = await readFile(file, 'utf8');
    idCache.set(file, new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1])));
  }
  return idCache.get(file);
};
const checkTarget = async (from, ref) => {
  const [p, frag] = ref.split('#');
  const target = p === '' ? from : await resolve(p.split('?')[0]);
  if (!target) return errors.push(`[BROKEN_LINK] ${path.relative(DIST, from)} → ${ref}`);
  if (frag && target.endsWith('.html') && !(await idsOf(target)).has(frag)) errors.push(`[BROKEN_ANCHOR] ${path.relative(DIST, from)} → ${ref}`);
};

let checked = 0;
for (const file of files.filter((f) => f.endsWith('.html'))) {
  const html = await readFile(file, 'utf8');
  for (const [, ref] of html.matchAll(/\s(?:href|src)="([^"]*)"/g)) {
    if (/^(https?:|mailto:|tel:|data:)/i.test(ref) || ref.startsWith('//')) continue;
    if (!ref.startsWith('/') && !ref.startsWith('#')) {
      errors.push(`[RELATIVE_LINK] ${path.relative(DIST, file)} → ${ref} (usa rutas absolutas)`);
      continue;
    }
    checked++;
    await checkTarget(file, ref);
  }
}

// sitemap.xml: cada <loc> debe existir.
const site = JSON.parse(await readFile(path.join(ROOT, 'data', 'site.json'), 'utf8'));
const SITE_URL = (process.env.SITE_URL || site.site_url).replace(/\/$/, '');
const sitemap = await readFile(path.join(DIST, 'sitemap.xml'), 'utf8');
for (const [, loc] of sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)) {
  checked++;
  if (!loc.startsWith(SITE_URL) || !(await resolve(loc.slice(SITE_URL.length) || '/'))) errors.push(`[BROKEN_SITEMAP] ${loc}`);
}

// _redirects: los destinos internos deben existir.
try {
  const redirects = await readFile(path.join(DIST, '_redirects'), 'utf8');
  for (const line of redirects.split('\n')) {
    const parts = line.trim().split(/\s+/);
    if (!line.trim() || line.trim().startsWith('#') || parts.length < 2) continue;
    checked++;
    if (parts[1].startsWith('/')) await checkTarget(path.join(DIST, 'index.html'), parts[1]);
  }
} catch {}

if (errors.length) {
  console.error(errors.join('\n'));
  console.error(`check-links: ${errors.length} errores`);
  process.exit(1);
}
console.log(`check-links: OK · ${checked} enlaces internos revisados · 0 errores, 0 avisos`);
