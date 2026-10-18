#!/usr/bin/env node
// Genera dist/ desde data/*.json y templates/*.html (SBJ-CODE-02). Sin dependencias.
// Variables de entorno:
//   CF_PAGES_BRANCH / BRANCH  rama de la build ("main" = producción)
//   PUBLISH_EN=1              genera también /en/ (oculto por ahora, §8.1)
//   SITE_URL                  sobrescribe data/site.json → site_url
import { readFile, writeFile, mkdir, rm, cp, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as R from './lib/render.mjs';
import { isPublishable } from './lib/press.mjs';

const { esc, txt, plain, pv, each, groupBy, ext, flagsPv, reviewFlags, shortDate, yearsLabel, ICONS } = R;
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(ROOT, 'dist');
const BRANCH = process.env.CF_PAGES_BRANCH || process.env.BRANCH || 'local';
const IS_PROD = BRANCH === 'main';
const PUBLISH_EN = process.env.PUBLISH_EN === '1';
const LANGS = PUBLISH_EN ? ['es', 'en'] : ['es'];
const BUILD_DATE = new Date();

const readData = async (f) => JSON.parse(await readFile(path.join(ROOT, 'data', f), 'utf8'));
const NAMES = ['site', 'profile', 'publications', 'press', 'talks', 'teaching', 'research', 'experience', 'awards', 'service'];
const D = Object.fromEntries(await Promise.all(NAMES.map(async (n) => [n, await readData(`${n}.json`)])));
const { site, profile } = D;
const SITE_URL = (process.env.SITE_URL || site.site_url).replace(/\/$/, '');

// ── Datos ordenados y derivados ─────────────────────────────────────────
const PUB_CAT = { libro: 'libro', articulo: 'articulo', capitulo: 'capitulo', divulgacion: 'divulgacion' };
const publications = [...D.publications].sort(R.byYearDesc());
const press = D.press.filter(isPublishable).sort((a, b) => (b.date > a.date ? 1 : b.date < a.date ? -1 : 0));
const pressTable = press.filter((n) => n.kind !== 'redes');
const data = {
  profile,
  publications,
  pubById: Object.fromEntries(D.publications.map((p) => [p.id, p])),
  press,
  pressById: Object.fromEntries(D.press.map((n) => [n.id, n])),
  featured: pressTable.filter((n) => n.featured),
  archive: pressTable.filter((n) => !n.featured),
  social: press.filter((n) => n.kind === 'redes'),
  syndicated: pressTable.filter((n) => (n.syndicated_urls || []).length),
  buroPress: pressTable.filter((n) => n.kind === 'datos_buro'),
  talks: [...D.talks].sort(R.byYearDesc()),
  teaching: D.teaching,
  research: [...D.research].sort((a, b) => Math.max(0, ...b.years) - Math.max(0, ...a.years)),
  experience: D.experience,
  awards: [...D.awards].sort(R.byYearDesc()),
  awardById: Object.fromEntries(D.awards.map((a) => [a.id, a])),
  service: D.service,
};
const count = (arr, fn) => arr.filter(fn).length;
data.counts = {
  libros: count(publications, (p) => p.type === 'libro'),
  articulos: count(publications, (p) => p.type === 'articulo'),
  capitulos: count(publications, (p) => p.type === 'capitulo'),
  divulgacion: count(publications, (p) => p.type === 'divulgacion'),
  otros: count(publications, (p) => !PUB_CAT[p.type]),
  publicaciones: publications.length,
  conferencias: data.talks.length,
  internacionales: count(data.talks, (t) => t.international),
  tesis: count(D.teaching, (t) => t.kind === 'tesis'),
  cursos: count(D.teaching, (t) => t.kind === 'curso'),
  catedras: count(D.teaching, (t) => t.kind === 'catedra'),
  materias: count(D.teaching, (t) => t.kind === 'materia' || t.kind === 'seminario'),
  distinciones: data.awards.length,
  proyectos: data.research.length,
  medios: pressTable.length,
  destacados: data.featured.length,
  archivo: data.archive.length,
  redes: data.social.length,
};

// ── Componentes (clases de pacomendez.mx) ────────────────────────────────
const KIND = { cita: 'Cita', entrevista: 'Entrevista', datos_buro: 'Datos del Buró', columna: 'Columna', institucional: 'Institucional', sindicada: 'Sindicada', redes: 'Redes' };
const PUB_LABEL = { libro: 'Libro', articulo: 'Artículo', capitulo: 'Capítulo', divulgacion: 'Divulgación', dossier: 'Dossier', entrada: 'Entrada de diccionario', resena: 'Reseña', traduccion: 'Traducción', articulo_en_linea: 'Artículo en línea', documento: 'Documento de trabajo', en_proceso: 'En proceso' };

const yearOrPv = (y) => (y ? esc(y) : 's. f.');
const pubUrl = (p) => p.url || (p.doi && `https://doi.org/${p.doi}`) || null;

function pubItem(p, ui, opts = {}) {
  const cat = PUB_CAT[p.type] || 'otros';
  const tags = `${cat}`;
  const refereed =
    p.refereed === true ? `<span class="sep"></span>${esc(ui.refereed)}` : '';
  const doi = p.doi ? `DOI: <a href="https://doi.org/${esc(p.doi)}" target="_blank" rel="noopener">${esc(p.doi)}</a>` : '';
  const rec = p.recognition ? `${doi ? '<span class="sep"></span>' : ''}${ext(p.recognition.url, txt(p.recognition.text))}` : '';
  const flags = flagsPv(p.flags);
  const copy = opts.copy === false ? '' : `<button type="button" class="copy small" data-copy="${esc(R.apa(p))}">${esc(ui.copy_apa)}</button>`;
  const link = pubUrl(p) ? ext(pubUrl(p), 'Fuente', 'mono') : '';
  if (p.type === 'libro' && opts.tray !== false) {
    const meta = [yearOrPv(p.year), txt(p.venue), p.publisher_place && esc(p.publisher_place), p.isbn && `ISBN ${esc(p.isbn)}`].filter(Boolean).map((s) => `<span>${s}</span>`).join('');
    const badge = `${p.role ? `<span class="badge">${txt(p.role)}</span>` : ''}${p.coauthor ? `<span>Coautoría con ${esc(p.coauthor)}</span>` : ''}`;
    return `<article class="tray compact" id="${esc(p.id)}" data-row data-tags="${tags}" lang="${esc(p.lang)}">
<div class="tray-head"><p class="kicker">${esc(PUB_LABEL[p.type]).toUpperCase()}</p><h3>${txt(p.title)}</h3></div>
<div class="tray-body"><p class="meta">${meta}${badge}</p>${flags ? `<p>${flags}</p>` : ''}
<ul class="tray-links">${pubUrl(p) ? `<li>${ext(pubUrl(p), 'Ficha editorial')}</li>` : ''}${(p.extra_urls || []).map((u) => `<li>${ext(u, 'Enlace adicional')}</li>`).join('')}</ul>
<div class="actions">${copy}</div></div></article>`;
  }
  const venue = [txt(p.venue), p.pages && `pp. ${esc(p.pages)}`].filter(Boolean).join(', ');
  return `<div class="form-row" id="${esc(p.id)}" data-row data-tags="${tags}" lang="${esc(p.lang)}"><span class="y">${yearOrPv(p.year)}</span><div>
<p class="label-mono">${esc(PUB_LABEL[p.type]).toUpperCase()}${p.role ? ` · ${txt(p.role)}` : ''}${p.coauthor ? ` · COAUTORÍA CON ${esc(p.coauthor).toUpperCase()}` : ''}</p>
<h3>${txt(p.title)}</h3><p class="inst">${venue}</p>
${doi || refereed || rec ? `<p class="note">${doi}${refereed}${rec}</p>` : ''}${flags ? `<p>${flags}</p>` : ''}
<p class="actions">${link}${copy}</p></div></div>`;
}

const PRESS_HEAD = `<div class="trow prensa thead" aria-hidden="true"><span>FECHA</span><span>MEDIO</span><span>TIPO</span><span>TITULAR</span><span>TEMA</span><span>ENLACE</span></div>`;
function pressRow(n, ui) {
  const tipo = esc(KIND[n.kind] || n.kind);
  const live = n.http_status === 200;
  const href = live ? n.url : n.archive_url;
  const label = live ? ui.source : ui.archive;
  const other = reviewFlags(n.flags);
  const year = n.date.slice(0, 4);
  return `<div class="trow prensa" data-row data-tags="y${year}" data-kind="${esc(n.kind)}"><span class="p-f y">${esc(shortDate(n.date))}</span><span class="p-m">${esc(n.outlet)}</span><span class="p-tipo">${tipo}</span><span class="p-t" data-verbatim>“${esc(n.title)}”${other.length ? ` ${flagsPv(other)}` : ''}</span><span class="p-c">${esc((n.topics || []).filter((t) => t !== 'Sin tema' && t !== 'Otras').join(' · '))}</span><span class="p-link"><a class="mono" href="${esc(href)}" target="_blank" rel="noopener">${esc(label)} ↗</a></span></div>`;
}

const CONF_HEAD = `<div class="trow conf thead" aria-hidden="true"><span>AÑO</span><span>INSTITUCIÓN</span><span>TÍTULO</span><span>ROL</span><span>ENLACE</span></div>`;
function confRow(t, ui) {
  const { title, inst } = R.parseTalk(t);
  const decade = t.year ? `${Math.floor(t.year / 10) * 10}s` : 'sin-anio';
  const urls = [t.url, ...(t.extra_urls || [])].filter(Boolean);
  const links = urls.map((u, i) => `<a class="small" href="${esc(u)}" target="_blank" rel="noopener">${R.isVideo(u) ? ui.video : ui.link}${urls.length > 1 ? ` ${i + 1}` : ''} ↗</a>`).join('<br>');
  const flags = flagsPv((t.flags || []).filter((f) => !/año faltante/.test(f)));
  return `<div class="trow conf" data-row data-tags="${decade}${t.international ? ' intl' : ''}"><span class="c-y y">${yearOrPv(t.year)}</span><span class="c-inst">${txt(inst)}</span><span class="c-t">${txt(title)}${t.international ? `<span class="intl">${esc(ui.intl)}</span>` : ''}${flags ? ` ${flags}` : ''}</span><span class="c-rol">${txt(t.role.replace(/[,\s]+$/, ''))}</span><span class="c-link">${links}</span></div>`;
}

function formRow({ y, h3, inst, note, flags, id, tags }) {
  return `<div class="form-row"${id ? ` id="${esc(id)}"` : ''}${tags ? ` data-row data-tags="${esc(tags)}"` : ''}><span class="y">${y || ''}</span><div><h3>${h3}</h3>${inst ? `<p class="inst">${inst}</p>` : ''}${note ? `<p class="note">${note}</p>` : ''}${flags ? `<p>${flags}</p>` : ''}</div></div>`;
}

let accSeq = 0;
function acc(label, items) {
  const id = `acc-${++accSeq}`;
  return `<div class="acc"><button type="button" class="acc-btn" aria-expanded="true" aria-controls="${id}"><span>${esc(label)} (${items.length})</span><span class="sign" aria-hidden="true">–</span></button><ul id="${id}" class="pressbook is-open">${items.map((i) => `<li>${i}</li>`).join('')}</ul></div>`;
}
const accItem = (x) => (x.url ? `<a href="${esc(x.url)}" target="_blank" rel="noopener">${txt(x.text)} ↗</a>` : `<span class="pb-text">${txt(x.text)}</span>`);

function chips(target, label, options, ui) {
  return `<div class="chips multi" role="group" aria-label="${esc(label)}" data-filter-for="${target}"><button type="button" class="chip" data-filter="*" aria-pressed="true">${esc(ui.all)}</button>${options
    .filter((o) => o.n > 0)
    .map((o) => `<button type="button" class="chip" data-filter="${esc(o.v)}" aria-pressed="false">${esc(o.label)} <span class="mono">${o.n}</span></button>`)
    .join('')}</div><p class="sr-only" id="${target}-status" aria-live="polite"></p>`;
}
const moreBtn = (target) => `<button type="button" class="more" data-more-for="${target}" hidden></button>`;

function pageHead(route, lang) {
  return `<div class="kicker">${route.num} · ${esc(R.plain(route.label[lang] || route.label.es).toUpperCase())}</div><h1 class="page-h" id="titulo">${esc(route.label[lang] || route.label.es)}</h1>`;
}

const PROFILE_ICON = { ORCID: ICONS.orcid, 'Google Scholar': ICONS.scholar, 'ResearcherID (Web of Science)': ICONS.globe, 'Academia.edu': ICONS.book, 'Página institucional Tec': ICONS.building };
const academicProfiles = profile.profiles.filter((p) => PROFILE_ICON[p.label]);

// ── JSON-LD ──────────────────────────────────────────────────────────────
const PERSON_ID = `${SITE_URL}/#persona`;
const person = {
  '@type': 'Person',
  '@id': PERSON_ID,
  name: profile.name,
  alternateName: profile.alternate_names.map(plain),
  honorificPrefix: profile.honorific,
  jobTitle: plain(profile.job_title),
  url: `${SITE_URL}/`,
  affiliation: { '@type': 'CollegeOrUniversity', name: 'Tecnológico de Monterrey', url: profile.affiliation.url },
  alumniOf: [{ '@type': 'CollegeOrUniversity', name: 'Universidad Nacional Autónoma de México' }, { '@type': 'CollegeOrUniversity', name: 'Tecnológico de Monterrey' }],
  knowsAbout: profile.research_lines,
  sameAs: academicProfiles.map((p) => p.url),
};
const LD_TYPE = { libro: 'Book', articulo: 'ScholarlyArticle', capitulo: 'Chapter' };
const pubLD = (p) => ({
  '@type': LD_TYPE[p.type] || 'CreativeWork',
  '@id': `${SITE_URL}/publicaciones#${p.id}`,
  name: plain(p.title),
  ...(p.year ? { datePublished: String(p.year) } : {}),
  inLanguage: p.lang,
  author: { '@id': PERSON_ID },
  ...(p.type === 'libro' ? { publisher: { '@type': 'Organization', name: plain(p.venue) } } : { ...(p.venue ? { isPartOf: { '@type': p.type === 'capitulo' ? 'Book' : 'Periodical', name: plain(p.venue) } } : {}) }),
  ...(p.isbn ? { isbn: p.isbn } : {}),
  ...(p.pages ? { pagination: p.pages } : {}),
  ...(p.doi ? { sameAs: `https://doi.org/${p.doi}` } : {}),
  ...(p.url ? { url: p.url } : {}),
});
const jsonld = (obj) => JSON.stringify(obj).replace(/</g, '\\u003c');

// ── Plantillas: cada archivo es el cuerpo de un template literal ─────────
const KEYS = ['ctx', 'h', 'data', 'site', 'ui', 'page', 'lang', 'href', 'esc', 'txt', 'each'];
const templates = {};
for (const f of await readdir(path.join(ROOT, 'templates'))) {
  if (!f.endsWith('.html')) continue;
  const src = await readFile(path.join(ROOT, 'templates', f), 'utf8');
  templates[f.replace(/\.html$/, '')] = new Function(...KEYS, `return \`${src}\`;`);
}

const assetHref = async (rel) => `/${rel}?v=${createHash('sha256').update(await readFile(path.join(ROOT, rel))).digest('hex').slice(0, 10)}`;
const cssHref = await assetHref('assets/css/main.css');
const jsHref = await assetHref('assets/js/main.js');

const routeById = Object.fromEntries(site.routes.map((r) => [r.id, r]));
const pathFor = (route, lang) => (lang === 'es' ? route.path : route.path === '/' ? '/en/' : `/en${route.path}`);
const fileFor = (p) => (p.endsWith('/') ? `${p}index.html` : `${p}.html`);

const h = {
  ...R,
  pubItem,
  pressRow,
  confRow,
  formRow,
  acc,
  accItem,
  chips,
  moreBtn,
  pageHead,
  PRESS_HEAD,
  CONF_HEAD,
  KIND,
  PUB_LABEL,
  academicProfiles,
  PROFILE_ICON,
  count,
};

function toc(route, lang) {
  return `<ol class="toc">${site.routes
    .filter((r) => r.nav !== false)
    .map((r) => `<li><a href="${pathFor(r, lang)}"${r.id === route.id ? ' aria-current="page"' : ''}><span class="bar"></span><span class="num">${r.num}</span><span>${esc(r.label[lang] || r.label.es)}</span></a></li>`)
    .join('')}</ol>`;
}

function renderPage(route, lang) {
  const ui = site.ui[lang];
  const tr = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v[lang] ?? v.es : v);
  const pagePath = pathFor(route, lang);
  const href = (id) => pathFor(routeById[id], lang);
  const page = { ...route, url: pagePath };
  accSeq = 0;
  const args = (ctx) => [ctx, { ...h, ui, tr, pageHead: (r) => pageHead(r || route, lang), toc: () => toc(route, lang) }, data, site, ui, page, lang, href, esc, txt, each];

  const tpl = templates[route.template];
  if (!tpl) throw new Error(`Falta templates/${route.template}.html`);
  const content = tpl(...args({}));

  const canonical = `${SITE_URL}${pagePath}`;
  const graph = [person];
  if (route.id === 'publicaciones') graph.push(...publications.map(pubLD));
  graph.push({ '@type': route.id === 'inicio' ? 'ProfilePage' : 'WebPage', '@id': `${canonical}#pagina`, url: canonical, name: tr(route.title), inLanguage: lang === 'es' ? 'es-MX' : 'en', about: { '@id': PERSON_ID } });
  const alternates = PUBLISH_EN && route.id !== '404'
    ? ['es', 'en'].map((l) => `<link rel="alternate" hreflang="${l === 'es' ? 'es-MX' : 'en'}" href="${esc(SITE_URL + pathFor(route, l))}">`).join('\n') + `\n<link rel="alternate" hreflang="x-default" href="${esc(SITE_URL + pathFor(route, 'es'))}">`
    : '';
  const otherHref = pathFor(route, lang === 'es' ? 'en' : 'es');
  // /en/ preparado pero oculto (§8.1): sin href no hay enlace roto ni rastreo.
  const langSwitch = PUBLISH_EN
    ? `<a class="lang" href="${otherHref}" hreflang="${ui.lang_switch_lang}" lang="${ui.lang_switch_lang}">${esc(ui.lang_switch)}</a>`
    : `<span class="lang" hidden data-href="${otherHref}" lang="${ui.lang_switch_lang}">${esc(ui.lang_switch)}</span>`;

  const meta = {
    title: route.id === 'inicio' ? tr(route.title) : `${tr(route.title)} · ${site.site_name}`,
    description: plain(tr(route.description)),
    canonical,
    noindex: !IS_PROD || route.noindex,
    alternates,
    ogLocale: lang === 'es' ? 'es_MX' : 'en_US',
    ogImage: `${SITE_URL}/compartir.jpg`,
    jsonld: jsonld({ '@context': 'https://schema.org', '@graph': graph }),
  };
  const ctx = { meta, content, cssHref, jsHref, langSwitch, analytics: site.analytics, updated: R.longDate(BUILD_DATE), quick: quickLinks() };
  return templates[route.layout === 'legal' ? 'legal-layout' : 'layout'](...args(ctx));
}

function quickLinks() {
  return academicProfiles
    .filter((p) => ['ORCID', 'Google Scholar'].includes(p.label))
    .map((p) => `<a href="${esc(p.url)}" target="_blank" rel="noopener" aria-label="${esc(p.label)}" title="${esc(p.label)}">${PROFILE_ICON[p.label]}</a>`)
    .join('');
}

// ── Escritura ────────────────────────────────────────────────────────────
await rm(DIST, { recursive: true, force: true });
await mkdir(DIST, { recursive: true });
let pages = 0;
const sizes = {};
for (const lang of LANGS) {
  for (const route of site.routes) {
    const p = pathFor(route, lang);
    const out = path.join(DIST, fileFor(p));
    await mkdir(path.dirname(out), { recursive: true });
    const html = renderPage(route, lang);
    await writeFile(out, html);
    sizes[p] = Buffer.byteLength(html);
    pages++;
  }
}
const notKeep = (src) => path.basename(src) !== '.gitkeep';
await cp(path.join(ROOT, 'public'), DIST, { recursive: true, filter: notKeep });
await cp(path.join(ROOT, 'assets'), path.join(DIST, 'assets'), { recursive: true, filter: notKeep });
await writeFile(path.join(DIST, 'publicaciones.bib'), R.bibtex(publications));

const today = BUILD_DATE.toISOString().slice(0, 10);
const urls = site.routes
  .filter((r) => r.sitemap !== false && !r.noindex)
  .flatMap((r) => LANGS.map((lang) => `  <url>\n    <loc>${SITE_URL}${pathFor(r, lang)}</loc>\n    <lastmod>${today}</lastmod>\n  </url>`));
await writeFile(path.join(DIST, 'sitemap.xml'), `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join('\n')}\n</urlset>\n`);
await writeFile(
  path.join(DIST, 'robots.txt'),
  IS_PROD ? `User-agent: *\nAllow: /\n\nSitemap: ${SITE_URL}/sitemap.xml\n` : `# Build de vista previa (rama ${BRANCH})\nUser-agent: *\nDisallow: /\n`
);
await mkdir(path.join(ROOT, 'reports'), { recursive: true });
await writeFile(path.join(ROOT, 'reports', 'build-counts.json'), `${JSON.stringify({ counts: data.counts, sizes }, null, 2)}\n`);

// Peso por página sin imágenes: HTML + CSS + JS.
const shared = (await readFile(path.join(ROOT, 'assets/css/main.css'))).length + (await readFile(path.join(ROOT, 'assets/js/main.js'))).length;
const heavy = Object.entries(sizes).filter(([, b]) => b + shared > 300 * 1024);
const maxPage = Object.entries(sizes).sort((a, b) => b[1] - a[1])[0];
console.log(`build: ${pages} páginas · rama ${BRANCH}${IS_PROD ? ' (producción)' : ' (preview, noindex)'} · EN ${PUBLISH_EN ? 'publicado' : 'oculto'} · página más pesada ${maxPage[0]} ${((maxPage[1] + shared) / 1024).toFixed(1)} KB con CSS+JS`);
if (heavy.length) {
  console.error(`build: ERROR, páginas de más de 300 KB sin imágenes: ${heavy.map(([p]) => p).join(', ')}`);
  process.exit(1);
}
