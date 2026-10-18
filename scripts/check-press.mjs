#!/usr/bin/env node
// Verifica las URLs de prensa (SBJ-CODE-02 §7) y genera data/press.json + reports/*.csv.
// Entrada: data/raw/press_featured.json (CV) y data/raw/press_inbox.json (archivo de medios).
// Uso: node scripts/check-press.mjs [--refresh]   (sin --refresh reutiliza reports/.press-cache.json)
// No envía nada a "Save Page Now": solo consulta disponibilidad en Wayback.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { normUrl, pressBlockers } from './lib/press.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REPORTS = path.join(ROOT, 'reports');
const CACHE = path.join(REPORTS, '.press-cache.json');
const UA = 'sergiobarcena.mx link-check (+https://sergiobarcena.mx)';
const CONCURRENCY = 4;
const TIMEOUT = 15_000;
const MAX_BYTES = 700_000;
const REFRESH = process.argv.includes('--refresh');

const readJSON = async (p) => JSON.parse(await readFile(path.join(ROOT, p), 'utf8'));
const featured = await readJSON('data/raw/press_featured.json');
const inbox = await readJSON('data/raw/press_inbox.json');
let cache = {};
if (!REFRESH) {
  try {
    cache = JSON.parse(await readFile(CACHE, 'utf8'));
  } catch {}
}

// ── HTML → metadatos ─────────────────────────────────────────────────────
const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', laquo: '«', raquo: '»', ndash: '–', mdash: '—', hellip: '…', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', iexcl: '¡', iquest: '¿', ntilde: 'ñ', Ntilde: 'Ñ', aacute: 'á', eacute: 'é', iacute: 'í', oacute: 'ó', uacute: 'ú', Aacute: 'Á', Eacute: 'É', Iacute: 'Í', Oacute: 'Ó', Uacute: 'Ú', uuml: 'ü' };
const decode = (s) =>
  s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&([a-z]+);/gi, (m, n) => ENT[n] ?? m)
    .replace(/\s+/g, ' ')
    .trim();
const metaContent = (html, attr, name) => {
  const re = new RegExp(`<meta[^>]+${attr}=["']${name}["'][^>]*>`, 'i');
  const tag = html.match(re)?.[0];
  const v = tag?.match(/content=["']([^"']*)["']/i)?.[1] ?? tag?.match(/content=([^\s>]+)/i)?.[1];
  return v ? decode(v) : null;
};
function jsonLd(html) {
  const out = [];
  for (const m of html.matchAll(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const j = JSON.parse(m[1].trim());
      const flat = (x) => (Array.isArray(x) ? x.flatMap(flat) : x && x['@graph'] ? flat(x['@graph']) : x ? [x] : []);
      out.push(...flat(j));
    } catch {}
  }
  return out;
}
const authorName = (a) => (Array.isArray(a) ? a.map(authorName).filter(Boolean).join(', ') : typeof a === 'string' ? a : a?.name || null);

function parse(html, domain) {
  const ld = jsonLd(html);
  const art = ld.find((x) => /Article|NewsArticle|BlogPosting|VideoObject|ReportageNewsArticle|WebPage/i.test([].concat(x['@type']).join(' ')) && (x.datePublished || x.headline)) || {};
  const siteName = metaContent(html, 'property', 'og:site_name') || ld.find((x) => /Organization|NewsMediaOrganization|WebSite/.test([].concat(x['@type']).join(' ')))?.name || null;
  let title = metaContent(html, 'property', 'og:title') || metaContent(html, 'name', 'twitter:title') || (art.headline ? decode(String(art.headline)) : null);
  let titleSource = title ? 'og' : null;
  if (!title) {
    const t = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1];
    if (t) {
      title = decode(t);
      titleSource = 'title';
    }
  }
  // Quita el sufijo " | Medio" / " - Medio" solo si coincide con el nombre del sitio o el dominio.
  if (title) {
    const m = title.match(/^(.*\S)\s+[|\-–—·]\s+([^|\-–—·]+)$/);
    const base = domain.replace(/^www\./, '').split('.')[0].toLowerCase();
    if (m && (m[2].trim().toLowerCase() === (siteName || '').toLowerCase() || m[2].toLowerCase().replace(/\s/g, '').includes(base))) title = m[1];
  }
  const published =
    metaContent(html, 'property', 'article:published_time') ||
    (art.datePublished ? String(art.datePublished) : null) ||
    metaContent(html, 'name', 'date') ||
    metaContent(html, 'itemprop', 'datePublished');
  const author = metaContent(html, 'name', 'author') || authorName(art.author) || null;
  const description = metaContent(html, 'property', 'og:description') || metaContent(html, 'name', 'description');
  const text = html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ');
  return {
    title: title || null,
    title_source: titleSource,
    site_name: siteName,
    published,
    author,
    description,
    mentions_barcena: /B[aá]rcena/i.test(text),
    mentions_buro: /Bur[oó] Parlamentario/i.test(text),
  };
}

async function readBody(res) {
  const reader = res.body?.getReader();
  if (!reader) return new Uint8Array();
  const chunks = [];
  let size = 0;
  while (size < MAX_BYTES) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    size += value.length;
  }
  reader.cancel().catch(() => {});
  const buf = new Uint8Array(size);
  let o = 0;
  for (const c of chunks) {
    buf.set(c.subarray(0, Math.min(c.length, size - o)), o);
    o += c.length;
    if (o >= size) break;
  }
  return buf;
}
function toText(buf, contentType) {
  let cs = contentType?.match(/charset=([\w-]+)/i)?.[1];
  if (!cs) cs = new TextDecoder('latin1').decode(buf.subarray(0, 2048)).match(/<meta[^>]+charset=["']?([\w-]+)/i)?.[1];
  try {
    return new TextDecoder(cs || 'utf-8').decode(buf);
  } catch {
    return new TextDecoder('utf-8').decode(buf);
  }
}

async function check(url) {
  const r = { checked_at: new Date().toISOString() };
  try {
    const res = await fetch(url, {
      redirect: 'follow',
      headers: { 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.5', 'Accept-Language': 'es-MX,es;q=0.9' },
      signal: AbortSignal.timeout(TIMEOUT),
    });
    r.http_status = res.status;
    r.final_url = res.url;
    const ct = res.headers.get('content-type') || '';
    if (res.ok && /html|xml/i.test(ct)) Object.assign(r, parse(toText(await readBody(res), ct), new URL(res.url).hostname));
    else res.body?.cancel().catch(() => {});
  } catch (e) {
    r.http_status = null;
    r.error = e.name === 'TimeoutError' ? 'timeout' : (e.cause?.code || e.message || 'error').slice(0, 80);
  }
  try {
    const res = await fetch(`https://archive.org/wayback/available?url=${encodeURIComponent(url)}`, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(TIMEOUT) });
    const j = await res.json();
    const snap = j?.archived_snapshots?.closest;
    r.archive_url = snap?.available && String(snap.status) === '200' ? snap.url.replace(/^http:/, 'https:') : null;
    r.archive_checked = true;
  } catch {
    r.archive_url = null;
    r.archive_checked = false;
  }
  return r;
}

// ── Unión de destacados (CV) + archivo de medios ─────────────────────────
const inboxByFeatured = new Map(inbox.filter((x) => x.featured_id).map((x) => [x.featured_id, x]));
const records = [];
for (const f of featured) {
  const twin = inboxByFeatured.get(f.id);
  records.push({
    id: f.id,
    url: f.url,
    date: f.date,
    date_source: 'cv',
    outlet: f.outlet,
    outlet_source: 'cv',
    title: f.title,
    title_source: 'cv',
    author: f.author || null,
    context: f.context || null,
    format: f.format,
    kind: f.kind,
    kind_source: 'cv',
    topics: twin?.topics || [],
    syndicated_urls: [],
    featured: true,
    flags: [...(f.flags || []), ...(twin?.flags || [])],
    inbox_id: twin?.id || null,
  });
}
const groups = new Map();
for (const x of inbox) {
  if (x.featured_id) continue;
  const rec = {
    id: x.id,
    url: x.url,
    date: x.date && /^\d{4}-\d{2}/.test(x.date) ? x.date : null,
    date_source: x.date && /^\d{4}-\d{2}/.test(x.date) ? x.date_source || 'url' : null,
    year_hint: x.year_hint ?? null,
    outlet: null,
    title: null,
    author: null,
    context: null,
    format: x.format,
    kind: x.kind && /^columna/.test(x.kind) ? null : x.kind,
    kind_source: x.kind && !/^columna/.test(x.kind) ? 'inbox' : null,
    column_candidate: /^columna/.test(x.kind || ''),
    topics: x.topics || [],
    syndicated_urls: [],
    featured: false,
    flags: [...(x.flags || [])],
    safelink_unwrapped: !!x.safelink_unwrapped,
  };
  if (x.group) {
    // Réplicas sindicadas: una sola nota con las demás URLs en syndicated_urls.
    const head = groups.get(x.group);
    if (head) {
      head.syndicated_urls.push(x.url);
      continue;
    }
    rec.group = x.group;
    groups.set(x.group, rec);
  }
  records.push(rec);
}

// ── Revisión de URLs (con caché) ─────────────────────────────────────────
const queue = records.filter((r) => !cache[r.url]);
let done = 0;
const total = queue.length;
async function worker() {
  while (queue.length) {
    const r = queue.shift();
    cache[r.url] = await check(r.url);
    done++;
    if (done % 25 === 0 || done === total) {
      console.log(`check-press: ${done}/${total}`);
      await writeFile(CACHE, JSON.stringify(cache));
    }
  }
}
await mkdir(REPORTS, { recursive: true });
await Promise.all(Array.from({ length: CONCURRENCY }, worker));
await writeFile(CACHE, JSON.stringify(cache));

// ── Enriquecer, clasificar y deduplicar ─────────────────────────────────
const INSTITUTIONAL = /(\.gob\.mx|(^|\.)ine\.mx|(^|\.)iecm\.mx|(^|\.)ieem\.org\.mx|(^|\.)tec\.mx)$/i;
const isoDate = (s) => {
  if (!s) return null;
  const m = String(s).match(/^(\d{4})-(\d{2})(?:-(\d{2}))?/);
  return m ? (m[3] ? `${m[1]}-${m[2]}-${m[3]}` : `${m[1]}-${m[2]}`) : null;
};
const urlDate = (u) => {
  const m = u.match(/\/(20\d{2}|19\d{2})[/-](0[1-9]|1[0-2])(?:[/-](0[1-9]|[12]\d|3[01]))?(?:\/|$|-)/);
  return m ? (m[3] ? `${m[1]}-${m[2]}-${m[3]}` : `${m[1]}-${m[2]}`) : null;
};
const seen = new Map();
for (const r of records) {
  const c = cache[r.url] || {};
  r.http_status = c.http_status ?? null;
  r.final_url = c.final_url || null;
  r.archive_url = c.archive_url || null;
  r.checked_at = c.checked_at || null;
  if (c.error) r.fetch_error = c.error;
  const domain = new URL(r.final_url || r.url).hostname.replace(/^www\./, '');
  r.domain = domain;
  // Títulos genéricos de redes ("X en X", "Instagram") no sirven como titular.
  const cleanTitle = c.title && c.title.replace(/\s+[-|–—·]\s*$/, '').trim();
  const genericTitle = !cleanTitle || /^(X|Instagram|Facebook|Threads|TikTok|YouTube|Login|Inicia sesión)( en X)?$/i.test(cleanTitle);
  if (!r.title && !genericTitle) {
    r.title = cleanTitle;
    r.title_source = c.title_source;
  }
  if (!r.outlet && c.site_name && /\p{L}{2,}/u.test(c.site_name)) {
    r.outlet = c.site_name;
    r.outlet_source = 'og:site_name';
  }
  if (!r.outlet && r.title) {
    // Sin og:site_name: se muestra el dominio (dato verificable, no un nombre inventado).
    r.outlet = domain;
    r.outlet_source = 'dominio';
  }
  if (!r.date) {
    const d = isoDate(c.published) || urlDate(r.final_url || r.url) || urlDate(r.url);
    if (d) {
      r.date = d;
      r.date_source = isoDate(c.published) ? 'meta' : 'url';
    }
  }
  if (!r.author && c.author) r.author = c.author;
  r.mentions_barcena = !!c.mentions_barcena;
  r.mentions_buro = !!c.mentions_buro;

  // Clasificación automática (§7.5): sugerencia que Sergio aprueba.
  if (!r.kind) {
    let k = null;
    if (r.column_candidate) {
      if (r.author) k = /B[aá]rcena/i.test(r.author) ? 'columna' : 'cita';
    } else if (r.title && /B[aá]rcena/i.test(r.title)) k = 'cita';
    else if (/youtube\.com|youtu\.be/.test(domain) && /entrevista/i.test(r.title || '')) k = 'entrevista';
    else if (INSTITUTIONAL.test(domain)) k = 'institucional';
    else if (r.mentions_buro && !r.mentions_barcena) k = 'datos_buro';
    if (k) {
      r.kind = k;
      r.kind_source = 'auto';
      r.flags.push('tipo sugerido por check-press; sin confirmar, no se publica');
    }
  }
  delete r.column_candidate;

  const key = normUrl(r.final_url || r.url);
  const keyOrig = normUrl(r.url);
  const prev = seen.get(key) || seen.get(keyOrig);
  if (prev) r.dup_of = prev;
  else {
    seen.set(key, r.id);
    seen.set(keyOrig, r.id);
  }
}

await writeFile(path.join(ROOT, 'data', 'press.json'), `${JSON.stringify(records, null, 2)}\n`);

// ── Reportes ─────────────────────────────────────────────────────────────
const csvCell = (v) => {
  const s = Array.isArray(v) ? v.join(' | ') : v == null ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const COLS = ['id', 'url', 'final_url', 'http_status', 'title', 'outlet', 'date', 'date_source', 'topics', 'kind', 'format', 'archive_url', 'flags'];
const EXTRA = ['featured', 'kind_source', 'outlet_source', 'mentions_barcena', 'mentions_buro', 'fetch_error', 'blockers'];
const rows = records.map((r) => ({ ...r, blockers: pressBlockers(r) }));
const toCsv = (list) => [COLS.concat(EXTRA).join(','), ...list.map((r) => COLS.concat(EXTRA).map((k) => csvCell(r[k])).join(','))].join('\n') + '\n';
await writeFile(path.join(REPORTS, 'links-report.csv'), toCsv(rows));
const pending = rows.filter((r) => r.blockers.length);
await writeFile(path.join(REPORTS, 'press-pendientes.csv'), toCsv(pending));

const count = (fn) => rows.filter(fn).length;
const blockerTally = {};
for (const r of pending) for (const b of r.blockers) {
  const k = b.replace(/\s*\(.*\)$/, '').replace(/ de .*$/, '');
  blockerTally[k] = (blockerTally[k] || 0) + 1;
}
const summary = {
  generado: new Date().toISOString(),
  notas: rows.length,
  urls_revisadas: rows.length + rows.reduce((a, r) => a + r.syndicated_urls.length, 0),
  estado_200: count((r) => r.http_status === 200),
  rotas_4xx_5xx: count((r) => r.http_status >= 400),
  sin_respuesta: count((r) => r.http_status == null),
  archivadas_wayback: count((r) => r.archive_url),
  publicables: rows.length - pending.length,
  pendientes: pending.length,
  motivos_pendiente: blockerTally,
  tipo_sugerido_auto: count((r) => r.kind_source === 'auto'),
};
await writeFile(path.join(REPORTS, 'links-summary.json'), `${JSON.stringify(summary, null, 2)}\n`);
console.log(JSON.stringify(summary, null, 2));
