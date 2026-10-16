#!/usr/bin/env node
// Valida data/*.json y templates/*.html. Sale con código 1 ante cualquier error.
// Uso: node scripts/validate.mjs [--data <dir>] [--templates <dir>] [--branch <rama>]
import { readFile, readdir, access } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const arg = (name) => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
};
const DATA = path.resolve(ROOT, arg('--data') || 'data');
const TEMPLATES = path.resolve(ROOT, arg('--templates') || 'templates');
const BRANCH = arg('--branch') || process.env.CF_PAGES_BRANCH || process.env.BRANCH || 'local';
const IS_PROD = BRANCH === 'main';
const PUBLISH_EN = process.env.PUBLISH_EN === '1';

const errors = [];
const fail = (code, where, msg) => errors.push(`[${code}] ${where}: ${msg}`);

// ── Esquemas ─────────────────────────────────────────────────────────────
// Reglas: str, bool, year, date, url, str[] (≥1), str[]0 (puede ir vacío), url[], enum:a|b. Sufijo "?" = opcional.
const SPECS = {
  'publications.json': {
    fields: {
      id: 'str', type: 'enum:libro|articulo|capitulo|divulgacion|traduccion|documento', year: 'year',
      title: 'str', authors: 'str[]', venue: 'str', url: 'url?', doi: 'str?', refereed: 'bool',
      topics: 'str[]', lang: 'enum:es|en|pt|fr|de|it',
    },
    oneOf: [['url', 'doi']],
  },
  'press.json': {
    fields: {
      id: 'str', date: 'date', outlet: 'str', title: 'str', url: 'url',
      format: 'enum:texto|video|audio|redes',
      kind: 'enum:entrevista|cita|datos_buro|columna|institucional|sindicada|redes',
      topics: 'str[]', syndicated_urls: 'url[]?', archive_url: 'url?',
    },
  },
  'talks.json': { fields: { id: 'str', year: 'year', title: 'str', institution: 'str', city: 'str', country: 'str', role: 'str', url: 'url?' } },
  'awards.json': { fields: { id: 'str', year: 'year', name: 'str', grantor: 'str', url: 'url?', evidence: 'enum:enlace|constancia' } },
  'research.json': { fields: { id: 'str', title: 'str', role: 'str', partners: 'str[]0', period: 'str', url: 'url?' } },
  'teaching.json': { fields: { id: 'str', kind: 'enum:materia|curso|posgrado|tesis', title: 'str', institution: 'str', years: 'str', level: 'str?' } },
};

const isEmpty = (v) => v === undefined || v === null || (typeof v === 'string' && v.trim() === '');
const isUrl = (v) => {
  if (typeof v !== 'string') return false;
  if (v.startsWith('/') && !v.startsWith('//')) return true; // interno; se revisa aparte
  try {
    const u = new URL(v);
    return u.protocol === 'https:' || u.protocol === 'http:';
  } catch {
    return false;
  }
};
const isDate = (v) => {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
};
const MAX_YEAR = new Date().getFullYear() + 1;

function checkField(where, key, value, rule) {
  const optional = rule.endsWith('?');
  const r = optional ? rule.slice(0, -1) : rule;
  if (isEmpty(value) || (Array.isArray(value) && value.length === 0 && r !== 'str[]0' && !optional)) {
    if (!optional) fail('MISSING_FIELD', where, `falta "${key}"`);
    return;
  }
  const bad = (msg) => fail('INVALID_VALUE', where, `"${key}" ${msg}`);
  if (r === 'str') typeof value === 'string' || bad('debe ser texto');
  else if (r === 'bool') typeof value === 'boolean' || bad('debe ser true/false');
  else if (r === 'year') (Number.isInteger(value) && value >= 1950 && value <= MAX_YEAR) || fail('INVALID_DATE', where, `"${key}" no es un año válido (${value})`);
  else if (r === 'date') isDate(value) || fail('INVALID_DATE', where, `"${key}" no es una fecha YYYY-MM-DD válida (${value})`);
  else if (r === 'url') isUrl(value) || bad(`no es una URL válida (${value})`);
  else if (r === 'str[]' || r === 'str[]0') {
    if (!Array.isArray(value) || value.some((x) => typeof x !== 'string' || !x.trim())) bad('debe ser una lista de textos');
  } else if (r === 'url[]') {
    if (!Array.isArray(value)) bad('debe ser una lista de URLs');
    else value.forEach((u) => isUrl(u) || bad(`contiene una URL inválida (${u})`));
  } else if (r.startsWith('enum:')) {
    const opts = r.slice(5).split('|');
    opts.includes(value) || bad(`debe ser uno de ${opts.join('|')} (llegó "${value}")`);
  }
}

// ── Carga ────────────────────────────────────────────────────────────────
const loaded = {};
const REQUIRED_FILES = ['site.json', 'profile.json', ...Object.keys(SPECS)];
for (const f of REQUIRED_FILES) {
  try {
    loaded[f] = JSON.parse(await readFile(path.join(DATA, f), 'utf8'));
  } catch (e) {
    fail(e.code === 'ENOENT' ? 'MISSING_FILE' : 'INVALID_JSON', f, e.message);
  }
}

// ── Colecciones ──────────────────────────────────────────────────────────
let records = 0;
for (const [file, spec] of Object.entries(SPECS)) {
  const list = loaded[file];
  if (list === undefined) continue;
  if (!Array.isArray(list)) {
    fail('INVALID_VALUE', file, 'debe ser una lista');
    continue;
  }
  const ids = new Set();
  list.forEach((rec, i) => {
    records++;
    const where = `${file}#${rec.id || `[${i}]`}`;
    for (const [key, rule] of Object.entries(spec.fields)) checkField(where, key, rec[key], rule);
    for (const group of spec.oneOf || []) {
      if (group.every((k) => isEmpty(rec[k]))) fail('MISSING_FIELD', where, `falta ${group.join(' o ')}`);
    }
    if (rec.id) {
      if (ids.has(rec.id)) fail('DUPLICATE_ID', where, 'id repetido');
      ids.add(rec.id);
    }
  });
}

// ── Perfil y sitio ───────────────────────────────────────────────────────
const profile = loaded['profile.json'];
if (profile) {
  for (const k of ['name', 'job_title']) checkField('profile.json', k, profile[k], 'str');
  checkField('profile.json', 'alternate_names', profile.alternate_names, 'str[]');
  checkField('profile.json', 'alumni_of', profile.alumni_of, 'str[]');
  checkField('profile.json', 'topics', profile.topics, 'str[]');
  checkField('profile.json', 'affiliation.name', profile.affiliation?.name, 'str');
  checkField('profile.json', 'bio_short.es', profile.bio_short?.es, 'str');
  checkField('profile.json', 'bio_long.es', profile.bio_long?.es, 'str[]');
  (profile.profiles || []).forEach((p, i) => {
    checkField(`profile.json#profiles[${i}]`, 'name', p.name, 'str');
    checkField(`profile.json#profiles[${i}]`, 'url', p.url, 'url');
  });
}

const site = loaded['site.json'];
const routePaths = new Set();
if (site) {
  for (const r of site.routes || []) {
    const where = `site.json#${r.id}`;
    for (const k of ['id', 'path', 'template']) checkField(where, k, r[k], 'str');
    for (const k of ['label', 'title', 'description']) checkField(where, `${k}.es`, r[k]?.es, 'str');
    if (r.path) routePaths.add(r.path);
    if (r.template) {
      try {
        await access(path.join(TEMPLATES, `${r.template}.html`));
      } catch {
        fail('MISSING_FILE', where, `no existe templates/${r.template}.html`);
      }
    }
  }
}

// ── Enlaces internos dentro de los datos ─────────────────────────────────
const publicFiles = new Set(['/publicaciones.bib', '/sitemap.xml', '/robots.txt']);
try {
  for (const f of await readdir(path.join(ROOT, 'public'))) if (!f.startsWith('_')) publicFiles.add(`/${f}`);
} catch {}

// Recorre todos los textos de un valor con su ruta de claves.
function* strings(value, keys = []) {
  if (typeof value === 'string') yield [value, keys];
  else if (Array.isArray(value)) for (let i = 0; i < value.length; i++) yield* strings(value[i], [...keys, i]);
  else if (value && typeof value === 'object') for (const [k, v] of Object.entries(value)) yield* strings(v, [...keys, k]);
}
const whereOf = (file, keys, root) => {
  const rec = Array.isArray(root) ? root[keys[0]] : null;
  return `${file}#${rec?.id ?? keys.join('.')}`;
};

// ── Reglas de texto (datos y plantillas) ─────────────────────────────────
const SECOND_PERSON = [/\btu (libro|investigaci|trabajo|análisis)/i, /\btus (libros|investigaciones|trabajos|publicaciones|análisis)/i];
const PHONE = [/\+\s*52[\s.-]*\(?\s*55\s*\)?/, /\(\s*55\s*\)\s*\d{4}/, /(?<![\w.\/-])55[\s.-]?\d{4}[\s.-]?\d{4}(?![\w])/];
// Patrones privados (p. ej. el teléfono exacto del CV) en un archivo fuera de git.
try {
  const extra = await readFile(path.join(ROOT, '.private-patterns'), 'utf8');
  for (const line of extra.split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'))) {
    PHONE.push(new RegExp(line.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '[\\s.-]*')));
  }
} catch {}
const PENDING = [/\[POR VERIFICAR\]/, /example\.org\/por-verificar/i];

function checkText(s, where, keys = []) {
  if (/safelinks\.protection\.outlook\.com/i.test(s)) fail('SAFELINKS', where, 'URL de safelinks de Outlook; usa la URL original');
  if (SECOND_PERSON.some((re) => re.test(s))) fail('SECOND_PERSON', where, `segunda persona en texto público: "${s.slice(0, 80)}"`);
  if (PHONE.some((re) => re.test(s))) fail('PHONE', where, 'contiene un teléfono');
  // EN no publicado: sus pendientes no bloquean main.
  const enHidden = !PUBLISH_EN && keys.includes('en');
  if (IS_PROD && !enHidden && PENDING.some((re) => re.test(s))) fail('POR_VERIFICAR_MAIN', where, `queda contenido sin verificar: "${s.slice(0, 80)}"`);
}

for (const [file, root] of Object.entries(loaded)) {
  for (const [s, keys] of strings(root)) {
    const where = whereOf(file, keys, root);
    checkText(s, where, keys);
    if (s.startsWith('/') && !s.startsWith('//')) {
      const p = s.split(/[?#]/)[0] || '/';
      if (!routePaths.has(p) && !publicFiles.has(p)) fail('BROKEN_INTERNAL_LINK', where, `enlace interno roto: ${s}`);
    }
  }
}
try {
  for (const f of await readdir(TEMPLATES)) {
    if (!f.endsWith('.html')) continue;
    const src = await readFile(path.join(TEMPLATES, f), 'utf8');
    src.split('\n').forEach((line, i) => checkText(line, `templates/${f}:${i + 1}`));
  }
} catch (e) {
  fail('MISSING_FILE', 'templates', e.message);
}

// ── URLs duplicadas en prensa ────────────────────────────────────────────
const norm = (u) => {
  try {
    const x = new URL(u);
    x.hash = '';
    for (const k of [...x.searchParams.keys()]) if (/^(utm_|fbclid|gclid)/i.test(k)) x.searchParams.delete(k);
    return `${x.hostname.replace(/^www\./, '').toLowerCase()}${x.pathname.replace(/\/+$/, '')}${x.search}`;
  } catch {
    return u;
  }
};
const seen = new Map();
for (const rec of Array.isArray(loaded['press.json']) ? loaded['press.json'] : []) {
  for (const u of [rec.url, ...(rec.syndicated_urls || []), rec.archive_url].filter(Boolean)) {
    const k = norm(u);
    if (seen.has(k)) fail('DUPLICATE_URL', `press.json#${rec.id}`, `${u} ya aparece en ${seen.get(k)} (las sindicadas van en syndicated_urls)`);
    else seen.set(k, rec.id);
  }
}

// ── Resultado ────────────────────────────────────────────────────────────
const rel = path.relative(ROOT, DATA) || '.';
if (errors.length) {
  console.error(errors.join('\n'));
  console.error(`validate: ${errors.length} errores en ${rel} (rama ${BRANCH})`);
  process.exit(1);
}
console.log(`validate: OK · ${records} registros en ${rel} · rama ${BRANCH} · 0 errores, 0 avisos`);
