#!/usr/bin/env node
// Genera dist/ desde data/*.json y templates/*.html. Sin dependencias.
// Variables de entorno:
//   CF_PAGES_BRANCH / BRANCH  rama de la build ("main" = producción)
//   PUBLISH_EN=1              genera también /en/ (por ahora desactivado)
//   SITE_URL                  sobrescribe data/site.json → site_url
import { readFile, writeFile, mkdir, rm, cp, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(ROOT, 'dist');
const BRANCH = process.env.CF_PAGES_BRANCH || process.env.BRANCH || 'local';
const IS_PROD = BRANCH === 'main';
const PUBLISH_EN = process.env.PUBLISH_EN === '1';
const LANGS = PUBLISH_EN ? ['es', 'en'] : ['es'];

const readData = async (f) => JSON.parse(await readFile(path.join(ROOT, 'data', f), 'utf8'));
const [site, profile, publications, press, talks, teaching, research, awards] = await Promise.all(
  ['site', 'profile', 'publications', 'press', 'talks', 'teaching', 'research', 'awards'].map((n) => readData(`${n}.json`))
);
const SITE_URL = (process.env.SITE_URL || site.site_url).replace(/\/$/, '');

// ── Helpers disponibles en las plantillas ────────────────────────────────
const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ESC[c]);
// Texto visible: escapa y resalta [POR VERIFICAR] en preview.
const txt = (v) => esc(v).replace(/\[POR VERIFICAR\]/g, '<mark class="pv">[POR VERIFICAR]</mark>');
const each = (arr, fn) => (arr || []).map(fn).join('');
const groupBy = (arr, fn) => {
  const m = new Map();
  for (const x of arr) {
    const k = fn(x);
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(x);
  }
  return [...m];
};
const desc = (key) => (a, b) => (a[key] < b[key] ? 1 : a[key] > b[key] ? -1 : 0);
const fmtDate = (iso, lang) =>
  new Date(`${iso}T12:00:00Z`).toLocaleDateString(lang === 'es' ? 'es-MX' : 'en-US', {
    year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC',
  });
const link = (url, label) => (url ? `<a href="${esc(url)}">${txt(label)}</a>` : txt(label));
const jsonld = (obj) => JSON.stringify(obj).replace(/</g, '\\u003c');

const routeById = Object.fromEntries(site.routes.map((r) => [r.id, r]));
const pathFor = (route, lang) => {
  if (lang === 'es') return route.path;
  return route.path === '/' ? '/en/' : `/en${route.path}`;
};
const fileFor = (p) => (p.endsWith('/') ? `${p}index.html` : `${p}.html`);

// ── Plantillas: cada archivo es el cuerpo de un template literal ─────────
const KEYS = ['ctx', 'esc', 'txt', 'each', 'groupBy', 'fmtDate', 'link', 't', 'ui', 'lang', 'data', 'page', 'href'];
const templates = {};
for (const f of await readdir(path.join(ROOT, 'templates'))) {
  if (!f.endsWith('.html')) continue;
  const src = await readFile(path.join(ROOT, 'templates', f), 'utf8');
  templates[f.replace(/\.html$/, '')] = new Function(...KEYS, `return \`${src}\`;`);
}

// ── Assets con huella para invalidar caché ───────────────────────────────
const assetHref = async (rel) => {
  const buf = await readFile(path.join(ROOT, rel));
  return `/${rel}?v=${createHash('sha256').update(buf).digest('hex').slice(0, 10)}`;
};
const cssHref = await assetHref('assets/css/main.css');
const jsHref = await assetHref('assets/js/main.js');

// ── Datos ordenados para las plantillas ──────────────────────────────────
const data = {
  profile,
  publications: [...publications].sort(desc('year')),
  press: [...press].sort(desc('date')),
  talks: [...talks].sort(desc('year')),
  teaching,
  research,
  awards: [...awards].sort(desc('year')),
};

// ── JSON-LD ──────────────────────────────────────────────────────────────
const PERSON_ID = `${SITE_URL}/#persona`;
const person = {
  '@type': 'Person',
  '@id': PERSON_ID,
  name: profile.name,
  alternateName: profile.alternate_names,
  honorificPrefix: profile.honorific,
  jobTitle: profile.job_title,
  url: `${SITE_URL}/`,
  affiliation: { '@type': 'CollegeOrUniversity', name: profile.affiliation.name, url: profile.affiliation.url },
  alumniOf: profile.alumni_of.map((name) => ({ '@type': 'CollegeOrUniversity', name })),
  knowsAbout: profile.topics,
  sameAs: profile.profiles.map((p) => p.url).filter(Boolean),
};
const PUB_TYPES = { libro: 'Book', articulo: 'ScholarlyArticle', capitulo: 'Chapter' };
const pubLD = (p) => ({
  '@type': PUB_TYPES[p.type] || 'CreativeWork',
  '@id': `${SITE_URL}/publicaciones#${p.id}`,
  name: p.title,
  datePublished: String(p.year),
  inLanguage: p.lang,
  author: p.authors.map((a) => (a === profile.name ? { '@id': PERSON_ID } : { '@type': 'Person', name: a })),
  ...(p.type === 'libro' ? { publisher: { '@type': 'Organization', name: p.venue } } : { isPartOf: { '@type': 'CreativeWork', name: p.venue } }),
  ...(p.doi ? { identifier: `https://doi.org/${p.doi}`, sameAs: `https://doi.org/${p.doi}` } : {}),
  ...(p.url ? { url: p.url } : {}),
  keywords: p.topics.join(', '),
});

// ── Render ───────────────────────────────────────────────────────────────
const t = (lang) => (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v[lang] ?? v.es : v);

function renderPage(route, lang) {
  const ui = site.ui[lang];
  const tr = t(lang);
  const pagePath = pathFor(route, lang);
  const href = (id) => pathFor(routeById[id], lang);
  const page = { ...route, url: pagePath };
  const args = [{}, esc, txt, each, groupBy, fmtDate, link, tr, ui, lang, data, page, href];

  const tpl = templates[route.template];
  if (!tpl) throw new Error(`Falta templates/${route.template}.html`);
  const content = tpl(...args);

  const canonical = `${SITE_URL}${pagePath === '/' ? '/' : pagePath}`;
  const graph = [person];
  if (route.id === 'publicaciones') graph.push(...data.publications.map(pubLD));
  graph.push({
    '@type': 'WebPage', '@id': `${canonical}#pagina`, url: canonical, name: tr(route.title),
    inLanguage: lang === 'es' ? 'es-MX' : 'en', about: { '@id': PERSON_ID },
  });

  const alternates = PUBLISH_EN && route.id !== '404'
    ? [
        `<link rel="alternate" hreflang="es-MX" href="${esc(SITE_URL + pathFor(route, 'es'))}">`,
        `<link rel="alternate" hreflang="en" href="${esc(SITE_URL + pathFor(route, 'en'))}">`,
        `<link rel="alternate" hreflang="x-default" href="${esc(SITE_URL + pathFor(route, 'es'))}">`,
      ].join('\n')
    : '';

  const otherLang = lang === 'es' ? 'en' : 'es';
  const otherHref = pathFor(route, otherLang);
  // EN está preparado pero oculto: sin href no hay enlace roto ni rastreo.
  const langSwitch = PUBLISH_EN
    ? `<a class="lang" href="${otherHref}" hreflang="${ui.lang_switch_lang}" lang="${ui.lang_switch_lang}">${esc(ui.lang_switch)}</a>`
    : `<a class="lang" hidden data-href="${otherHref}" lang="${ui.lang_switch_lang}">${esc(ui.lang_switch)}</a>`;

  const nav = site.routes
    .filter((r) => r.nav !== false)
    .map((r) => {
      const p = pathFor(r, lang);
      const current = r.id === route.id ? ' aria-current="page"' : '';
      return `<li><a href="${p}"${current}>${esc(tr(r.label))}</a></li>`;
    })
    .join('');

  const title = route.id === 'inicio' ? tr(route.title) : `${tr(route.title)} · ${site.site_name}`;
  const meta = {
    title,
    description: tr(route.description),
    canonical,
    noindex: !IS_PROD || route.noindex,
    alternates,
    ogLocale: lang === 'es' ? 'es_MX' : 'en_US',
    jsonld: jsonld({ '@context': 'https://schema.org', '@graph': graph }),
  };
  const ctx = { meta, nav, langSwitch, content, cssHref, jsHref, isProd: IS_PROD, analytics: site.analytics, siteName: site.site_name, year: new Date().getFullYear() };
  return templates.layout(ctx, esc, txt, each, groupBy, fmtDate, link, tr, ui, lang, data, page, href);
}

// ── Escritura ────────────────────────────────────────────────────────────
await rm(DIST, { recursive: true, force: true });
await mkdir(DIST, { recursive: true });

let pages = 0;
for (const lang of LANGS) {
  for (const route of site.routes) {
    const out = path.join(DIST, fileFor(pathFor(route, lang)));
    await mkdir(path.dirname(out), { recursive: true });
    await writeFile(out, renderPage(route, lang));
    pages++;
  }
}

// public/ y assets/ se copian tal cual (sin .gitkeep).
const notKeep = (src) => path.basename(src) !== '.gitkeep';
await cp(path.join(ROOT, 'public'), DIST, { recursive: true, filter: notKeep });
await cp(path.join(ROOT, 'assets'), path.join(DIST, 'assets'), { recursive: true, filter: notKeep });
await cp(path.join(ROOT, 'data', 'publications.bib'), path.join(DIST, 'publicaciones.bib'));

// sitemap.xml y robots.txt (fuera de main todo es noindex).
const today = new Date().toISOString().slice(0, 10);
const urls = site.routes
  .filter((r) => r.sitemap !== false)
  .flatMap((r) =>
    LANGS.map((lang) => {
      const alt = PUBLISH_EN
        ? ['es', 'en'].map((l) => `\n    <xhtml:link rel="alternate" hreflang="${l === 'es' ? 'es-MX' : 'en'}" href="${SITE_URL}${pathFor(r, l)}"/>`).join('')
        : '';
      return `  <url>\n    <loc>${SITE_URL}${pathFor(r, lang)}</loc>\n    <lastmod>${today}</lastmod>${alt}\n  </url>`;
    })
  );
await writeFile(
  path.join(DIST, 'sitemap.xml'),
  `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n${urls.join('\n')}\n</urlset>\n`
);
await writeFile(
  path.join(DIST, 'robots.txt'),
  IS_PROD ? `User-agent: *\nAllow: /\n\nSitemap: ${SITE_URL}/sitemap.xml\n` : `# Build de vista previa (rama ${BRANCH})\nUser-agent: *\nDisallow: /\n`
);

// Peso total sin imágenes.
let bytes = 0;
const walk = async (dir) => {
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) await walk(p);
    else if (!/\.(avif|webp|png|jpe?g|gif|pdf)$/i.test(e.name)) bytes += (await readFile(p)).length;
  }
};
await walk(DIST);
console.log(`build: ${pages} páginas · rama ${BRANCH}${IS_PROD ? ' (producción)' : ' (preview, noindex)'} · EN ${PUBLISH_EN ? 'publicado' : 'oculto'} · ${(bytes / 1024).toFixed(1)} KB sin imágenes`);
if (bytes > 300 * 1024) {
  console.error('build: ERROR, el sitio pesa más de 300 KB sin imágenes');
  process.exit(1);
}
