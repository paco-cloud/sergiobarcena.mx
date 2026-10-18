#!/usr/bin/env node
// Aplica a data/*.json las decisiones de Paco Méndez del 18-oct-2026 para salir a producción:
//  1. Textos BORRADOR: se publican como están (aprobados por Paco); las frases POR DECIDIR se eliminan.
//  2. Correo público: ninguno por ahora.
//  3. Datos sin confirmar, modo conservador: "Arbitrado" solo donde el CV lo confirma; en
//     discrepancias se usa el texto del CV sin el enlace dudoso; duplicados se dejan una vez.
//  4. Buró Parlamentario: buroparlamentario.com (el .org redirige a un sitio ajeno).
// Es idempotente: se puede correr más de una vez. Uso: node scripts/apply-decisions.mjs
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const P = (f) => path.join(ROOT, 'data', f);
const read = async (f) => JSON.parse(await readFile(P(f), 'utf8'));
const write = (f, d) => writeFile(P(f), `${JSON.stringify(d, null, 2)}\n`);
const DECISION = 'Decisión de Paco Méndez, 18-oct-2026';
const BURO = 'https://buroparlamentario.com';
const dropFlags = (r, re) => {
  if (!r.flags) return;
  r.flags = r.flags.filter((f) => !re.test(f));
};

// ── profile.json ─────────────────────────────────────────────────────────
const profile = await read('profile.json');
profile._status = `G2 aprobado para publicación. ${DECISION}.`;
profile.alternate_names = profile.alternate_names.filter((n) => !/POR VERIFICAR/.test(n));
// Sin redacción acordada sobre la fundación de Buró: se quita la oración completa.
const sinFundacion = (s) => s.replace(/\s*En 2018 \[POR DECIDIR[^\]]*\] Buró Parlamentario,[^.]*\./g, '');
profile.bio_short.es = sinFundacion(profile.bio_short.es);
profile.bio_short.status = `Aprobada. ${DECISION}.`;
profile.bio_long.es = sinFundacion(profile.bio_long.es).replace(/\s*\[POR VERIFICAR: otorgante\]/g, '');
profile.bio_long.status = `Aprobada. ${DECISION}. Sin cifras fijas: el build las calcula de los JSON.`;
delete profile.hero.claim_status;
profile.hero.ctas = profile.hero.ctas.filter((c) => !c.status);
for (const p of profile.profiles) {
  if (/ResearcherID/.test(p.label)) p.url = 'https://www.webofscience.com/wos/author/rid/I-8078-2016';
  if (/Buró/.test(p.label)) p.url = BURO;
  if (p.note && /POR VERIFICAR|POR DECIDIR/.test(p.note)) delete p.note;
}
profile.email = { value: null, status: `Sin correo público por ahora. ${DECISION}.` };
await write('profile.json', profile);

// ── publications.json ────────────────────────────────────────────────────
let pubs = await read('publications.json');
// Duplicado: el capítulo de Zacatecas se queda una vez (2019, con enlace y páginas).
pubs = pubs.filter((p) => !['pub-2018-zacatecas-evolucion-politica-y-alternan', 'pub-2016-zacatecas-evolucion-politica-y-alternan'].includes(p.id));
for (const p of pubs) {
  if ((p.flags || []).some((f) => /refereed=true inferido/.test(f))) p.refereed = null;
  if ((p.flags || []).some((f) => /coautoría con Alejandro Lerma Kirchner/.test(f))) p.coauthor = 'Alejandro Lerma Kirchner';
  if ((p.flags || []).some((f) => /mismas pp\. 112-136/.test(f))) delete p.pages;
  if ((p.flags || []).some((f) => /DISCREPANCIA: el enlace es de Latin American Politics/.test(f))) delete p.url;
  if (p.role) p.role = p.role.replace(/\s*\[POR VERIFICAR[^\]]*\]/g, '').trim() || undefined;
  if (p.role && /coedición|coordinación/i.test(p.role) && p.id === 'pub-2025-women-as-builders-of-parity-democracy-in') delete p.role;
  dropFlags(p, /refereed=true inferido|POR VERIFICAR|POSIBLE DUPLICADO|DISCREPANCIA|\[confirmar\]/);
}
await write('publications.json', pubs);

// ── talks.json ───────────────────────────────────────────────────────────
const talks = await read('talks.json');
for (const t of talks) dropFlags(t, /POR VERIFICAR/);
await write('talks.json', talks);

// ── awards.json ──────────────────────────────────────────────────────────
const awards = await read('awards.json');
for (const a of awards) {
  // Medalla Helia Bravo Hollis: el enlace (Congreso CDMX) contradice al CV (Cámara de Diputados).
  if (a.id === 'aw-ganador-de-la-medalla-al-merito-helia-bravo-holl') {
    delete a.url;
    a.evidence = 'constancia';
    dropFlags(a, /enlace_redes/);
  }
  dropFlags(a, /DISCREPANCIA/);
}
await write('awards.json', awards);

// ── experience.json ──────────────────────────────────────────────────────
const exp = await read('experience.json');
for (const e of exp) {
  if (/Novomedia/.test(e.text)) delete e.url; // cargo y dominio sin confirmar: solo el texto del CV
  if (/Buró Parlamentario/.test(e.text)) e.url = BURO;
  dropFlags(e, /POR VERIFICAR|POR DECIDIR/);
}
await write('experience.json', exp);

// ── service.json: restos de la extracción del CV ─────────────────────────
const service = await read('service.json');
for (const list of Object.values(service)) for (const x of list) x.text = x.text.replace(/&type=author\)\s*/g, ' ').replace(/\s{2,}/g, ' ').trim();
await write('service.json', service);

// ── press.json: la fecha del CV manda en la nota de Expansión ────────────
const press = await read('press.json');
for (const n of press) dropFlags(n, /DISCREPANCIA de fecha/);
await write('press.json', press);

// ── site.json ────────────────────────────────────────────────────────────
const site = await read('site.json');
const clean = (s) => s.replace(/\s*\[(BORRADOR|POR DECIDIR)[^\]]*\]/g, '').trim();
site.home.buro_lines = site.home.buro_lines.map(clean).filter(Boolean);
site.home.hitos.forEach((h) => h.body && (h.body = clean(h.body)));
site.buro.url = BURO;
delete site.buro.url_status;
site.buro.paragraphs = site.buro.paragraphs.map(clean).filter(Boolean);
site.buro.method = clean(site.buro.method);
site.research.ia_lead = clean(site.research.ia_lead);
site.contact = {};
await write('site.json', site);

console.log('apply-decisions: OK');
