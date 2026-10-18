#!/usr/bin/env node
// Valida data/*.json y templates/*.html (SBJ-CODE-02 §5). Sale con código 1 ante cualquier error.
// Los avisos ([AVISO]) no detienen la build; hoy solo existen para publicaciones sin url ni doi.
// Uso: node scripts/validate.mjs [--data <dir>] [--templates <dir>] [--branch <rama>]
// data/raw/ (insumos de check-press) no se valida: no se publica.
import { readFile, readdir, access } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { normUrl } from './lib/press.mjs';

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
const warnings = [];
const fail = (code, where, msg) => errors.push(`[${code}] ${where}: ${msg}`);
const warn = (code, where, msg) => warnings.push(`[AVISO ${code}] ${where}: ${msg}`);

// ── Esquemas ─────────────────────────────────────────────────────────────
// Reglas: str, bool, year, date, url, int[], str[] (≥1), str[]0 (puede ir vacío), url[], enum:a|b.
// Sufijo "|null" = acepta null (sin confirmar, se pinta .pv). Sufijo "?" = opcional.
const PUB_TYPES = 'libro|articulo|capitulo|divulgacion|traduccion|documento|dossier|entrada|resena|articulo_en_linea|en_proceso';
const SPECS = {
  'publications.json': {
    id: 'str', type: `enum:${PUB_TYPES}`, year: 'year|null', title: 'str', authors: 'str[]', venue: 'str|null', citation_cv: 'str',
    url: 'url?', doi: 'str?', refereed: 'bool|null', topics: 'str[]0', lang: 'enum:es|en|pt|fr|de|it',
    role: 'str?', isbn: 'str?', pages: 'str?', extra_urls: 'url[]?', publisher_place: 'str?', flags: 'str[]0?',
  },
  'talks.json': {
    id: 'str', text: 'str', title: 'str|null', role: 'str', year: 'year|null', international: 'bool',
    url: 'url?', extra_urls: 'url[]?', flags: 'str[]0?',
  },
  'teaching.json': { id: 'str', kind: 'enum:catedra|materia|seminario|curso|tesis', text: 'str?', courses: 'str[]0?', years: 'int[]?', url: 'url?', flags: 'str[]0?' },
  'research.json': { id: 'str', role: 'str', text: 'str', years: 'int[]', url: 'url?' },
  'experience.json': { id: 'str', text: 'str', years: 'int[]', current: 'bool', url: 'url?', flags: 'str[]0?' },
  'awards.json': { id: 'str', year: 'year|null', text: 'str', evidence: 'enum:enlace|constancia', url: 'url?', flags: 'str[]0?' },
  'press.json': {
    id: 'str', url: 'url', format: 'enum:texto|video|audio|redes', kind: 'enum:cita|entrevista|datos_buro|columna|institucional|sindicada|redes|null',
    topics: 'str[]0', featured: 'bool', date: 'date|null', title: 'str|null', outlet: 'str|null',
    syndicated_urls: 'url[]?', archive_url: 'url|null?', http_status: 'int|null?', flags: 'str[]0',
  },
};

const isEmpty = (v) => v === undefined || (typeof v === 'string' && v.trim() === '');
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
// Fecha completa (YYYY-MM-DD) o con mes (YYYY-MM); se valida que exista en el calendario.
const isDate = (v) => {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}(-\d{2})?$/.test(v)) return false;
  const full = v.length === 7 ? `${v}-01` : v;
  const d = new Date(`${full}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === full;
};
const MAX_YEAR = new Date().getFullYear() + 1;
const isYear = (v) => Number.isInteger(v) && v >= 1950 && v <= MAX_YEAR;

function checkField(where, key, value, rule) {
  const optional = rule.endsWith('?');
  let r = optional ? rule.slice(0, -1) : rule;
  const nullable = r.endsWith('|null');
  if (nullable) r = r.slice(0, -5);
  if (value === null && (nullable || optional)) return;
  if (isEmpty(value) || value === null) {
    if (!optional) fail('MISSING_FIELD', where, `falta "${key}"`);
    return;
  }
  const bad = (msg) => fail('INVALID_VALUE', where, `"${key}" ${msg}`);
  if (r === 'str') typeof value === 'string' || bad('debe ser texto');
  else if (r === 'bool') typeof value === 'boolean' || bad('debe ser true/false');
  else if (r === 'int') Number.isInteger(value) || bad('debe ser un entero');
  else if (r === 'year') isYear(value) || fail('INVALID_DATE', where, `"${key}" no es un año válido (${value})`);
  else if (r === 'date') isDate(value) || fail('INVALID_DATE', where, `"${key}" no es una fecha YYYY-MM-DD o YYYY-MM válida (${value})`);
  else if (r === 'url') isUrl(value) || bad(`no es una URL válida (${value})`);
  else if (r === 'int[]') (Array.isArray(value) && value.every(isYear)) || bad('debe ser una lista de años');
  else if (r === 'str[]' || r === 'str[]0') {
    if (!Array.isArray(value) || value.some((x) => typeof x !== 'string' || !x.trim())) bad('debe ser una lista de textos');
    else if (r === 'str[]' && !value.length) fail('MISSING_FIELD', where, `"${key}" está vacío`);
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
const REQUIRED_FILES = ['site.json', 'profile.json', 'service.json', ...Object.keys(SPECS)];
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
    for (const [key, rule] of Object.entries(spec)) checkField(where, key, rec[key], rule);
    if (rec.id) {
      if (ids.has(rec.id)) fail('DUPLICATE_ID', where, 'id repetido');
      ids.add(rec.id);
    }
    if (file === 'publications.json' && isEmpty(rec.url) && isEmpty(rec.doi)) warn('SIN_ENLACE', where, 'publicación sin url ni doi');
    if (file === 'teaching.json') {
      if (rec.kind === 'tesis') for (const k of ['title', 'program_institution', 'role', 'status']) checkField(where, k, rec[k], 'str');
      else checkField(where, 'text', rec.text, 'str');
    }
  });
}

// ── Perfil, servicio y sitio ─────────────────────────────────────────────
const profile = loaded['profile.json'];
if (profile) {
  const w = 'profile.json';
  for (const k of ['name', 'job_title']) checkField(w, k, profile[k], 'str');
  for (const k of ['alternate_names', 'alumni_of', 'research_lines', 'languages', 'software']) checkField(w, k, profile[k], 'str[]');
  checkField(w, 'affiliation.name', profile.affiliation?.name, 'str');
  checkField(w, 'bio_short.es', profile.bio_short?.es, 'str');
  checkField(w, 'bio_long.es', profile.bio_long?.es, 'str');
  for (const k of ['kicker', 'display_name', 'fullname', 'tags', 'claim']) checkField(w, `hero.${k}`, profile.hero?.[k], 'str');
  (profile.education || []).forEach((e, i) => checkField(`${w}#education[${i}]`, 'degree', e.degree, 'str'));
  (profile.affiliations || []).forEach((e, i) => checkField(`${w}#affiliations[${i}]`, 'text', e.text, 'str'));
  (profile.profiles || []).forEach((p, i) => {
    checkField(`${w}#profiles[${i}]`, 'label', p.label, 'str');
    checkField(`${w}#profiles[${i}]`, 'url', p.url, 'url');
  });
}
const service = loaded['service.json'];
if (service) {
  for (const k of ['evaluaciones', 'presentaciones_de_libros', 'formacion_continua']) {
    if (!Array.isArray(service[k])) fail('MISSING_FIELD', 'service.json', `falta la lista "${k}"`);
    else service[k].forEach((x, i) => {
      checkField(`service.json#${k}[${i}]`, 'text', x.text, 'str');
      checkField(`service.json#${k}[${i}]`, 'year', x.year, 'year|null');
    });
  }
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

// ── Recorrido de textos ──────────────────────────────────────────────────
const publicFiles = new Set(['/publicaciones.bib', '/sitemap.xml', '/robots.txt']);
try {
  for (const f of await readdir(path.join(ROOT, 'public'))) if (!f.startsWith('_')) publicFiles.add(`/${f}`);
} catch {}

function* strings(value, keys = [], parent = null) {
  if (typeof value === 'string') yield [value, keys, parent];
  else if (Array.isArray(value)) for (let i = 0; i < value.length; i++) yield* strings(value[i], [...keys, i], parent);
  else if (value && typeof value === 'object') for (const [k, v] of Object.entries(value)) yield* strings(v, [...keys, k], value);
}
const whereOf = (file, keys, root) => {
  const rec = Array.isArray(root) ? root[keys[0]] : null;
  return `${file}#${rec?.id ?? keys.join('.')}`;
};

const SECOND_PERSON = [/\btu (libro|investigaci|trabajo|análisis)/i, /\btus (libros|investigaciones|trabajos|publicaciones|análisis)/i];
const PHONE = [/\+\s?52\b/, /\(\s*55\s*\)/, /(?<![\w.\/=-])55[\s.-]?\d{4}[\s.-]?\d{4}(?![\w])/];
const MONEY = [/\$\s?\d/, /\bUSD\b/, /\bMXN\b/, /\d[\d.,]*\s?(dólares|pesos mexicanos)\b/i];
const PRIVATE_LINKS = /drive\.google|docs\.google/i;
// Patrones privados (p. ej. el teléfono exacto del CV) en un archivo fuera de git.
try {
  const extra = await readFile(path.join(ROOT, '.private-patterns'), 'utf8');
  for (const line of extra.split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'))) {
    PHONE.push(new RegExp(line.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '[\\s.-]*')));
  }
} catch {}
const PENDING = /BORRADOR|POR VERIFICAR|POR DECIDIR|DISCREPANCIA|POSIBLE DUPLICADO|confirmar\]|; confirmar|\[PENDIENTE(?! INTEGRACIÓN)|example\.org\/por-verificar/i;

function checkText(s, where, keys = []) {
  if (/safelinks\.protection\.outlook\.com/i.test(s)) fail('SAFELINKS', where, 'URL de safelinks de Outlook; usa la URL original');
  if (PRIVATE_LINKS.test(s)) fail('PRIVATE_LINK', where, 'enlace a Google Drive/Docs');
  if (SECOND_PERSON.some((re) => re.test(s))) fail('SECOND_PERSON', where, `segunda persona en texto público: "${s.slice(0, 80)}"`);
  if (PHONE.some((re) => re.test(s))) fail('PHONE', where, 'contiene un teléfono o lada +52 / (55)');
  if (MONEY.some((re) => re.test(s))) fail('MONEY', where, `contiene un monto: "${s.slice(0, 80)}"`);
  // EN no publicado: sus pendientes no bloquean main.
  const enHidden = !PUBLISH_EN && keys.includes('en');
  if (IS_PROD && !enHidden && PENDING.test(s)) fail('POR_VERIFICAR_MAIN', where, `queda contenido sin aprobar: "${s.slice(0, 80)}"`);
}

for (const [file, root] of Object.entries(loaded)) {
  for (const [s, keys, parent] of strings(root)) {
    const where = whereOf(file, keys, root);
    // profile.email y profile.phone no se publican: solo se revisa que no lleguen a una plantilla.
    if (file === 'profile.json' && (keys[0] === 'phone' || keys[0] === 'email')) continue;
    checkText(s, where, keys);
    if (s.startsWith('/') && !s.startsWith('//')) {
      const p = s.split(/[?#]/)[0] || '/';
      const pending = parent && /POR DECIDIR|PENDIENTE/.test(parent.status || '');
      if (!pending && !routePaths.has(p) && !publicFiles.has(p)) fail('BROKEN_INTERNAL_LINK', where, `enlace interno roto: ${s}`);
    }
  }
}
try {
  for (const f of await readdir(TEMPLATES)) {
    if (!f.endsWith('.html')) continue;
    const src = await readFile(path.join(TEMPLATES, f), 'utf8');
    src.split('\n').forEach((line, i) => checkText(line, `templates/${f}:${i + 1}`));
    if (/data\.profile\.(email|phone)/.test(src)) fail('PRIVATE_DATA', `templates/${f}`, 'la plantilla usa profile.email/phone (no se publican)');
  }
} catch (e) {
  fail('MISSING_FILE', 'templates', e.message);
}

// ── URLs duplicadas en prensa (dominio + ruta, sin query ni utm_*) ───────
// Los duplicados que check-press ya marcó con dup_of quedan fuera del HTML y no cuentan.
const seen = new Map();
for (const rec of Array.isArray(loaded['press.json']) ? loaded['press.json'] : []) {
  if (rec.dup_of) continue;
  for (const u of [rec.url, ...(rec.syndicated_urls || [])].filter(Boolean)) {
    const k = normUrl(u);
    if (seen.has(k)) fail('DUPLICATE_URL', `press.json#${rec.id}`, `${u} ya aparece en ${seen.get(k)} (las sindicadas van en syndicated_urls)`);
    else seen.set(k, rec.id);
  }
}

// ── Resultado ────────────────────────────────────────────────────────────
const rel = path.relative(ROOT, DATA) || '.';
if (warnings.length) console.log(warnings.join('\n'));
if (errors.length) {
  console.error(errors.join('\n'));
  console.error(`validate: ${errors.length} errores, ${warnings.length} avisos en ${rel} (rama ${BRANCH})`);
  process.exit(1);
}
console.log(`validate: OK · ${records} registros en ${rel} · rama ${BRANCH} · 0 errores, ${warnings.length} avisos${warnings.length ? ' (publicaciones sin url ni doi, permitidos por §9)' : ''}`);
