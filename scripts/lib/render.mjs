// Helpers de render para las plantillas (SBJ-CODE-02). Todo texto pasa por esc() o txt().

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ESC[c]);

// Marcadores de revisión que se pintan como .pv y bloquean producción.
export const MARKER_RE = /\[(?:POR VERIFICAR|POR DECIDIR|PENDIENTE|BORRADOR|confirmar)[^\]]*\]/g;
export const BLOCKING_FLAG_RE = /^(DISCREPANCIA|POR VERIFICAR|POR DECIDIR|POSIBLE DUPLICADO|BORRADOR)|confirmar|POR DECIDIR|POR VERIFICAR/i;

// Texto visible: escapa y convierte [POR VERIFICAR …] etc. en .pv
export const txt = (v) => esc(v).replace(/\[(?:POR VERIFICAR|POR DECIDIR|PENDIENTE|BORRADOR|confirmar)[^\]]*\]/g, (m) => `<span class="pv">${m.slice(1, -1)}</span>`);
// Texto plano para copiar o para metadatos: sin marcadores.
export const plain = (v) => String(v ?? '').replace(MARKER_RE, '').replace(/\s{2,}/g, ' ').trim();
export const pv = (label, title) => `<span class="pv"${title ? ` title="${esc(title)}"` : ''}>${esc(label)}</span>`;

// Flags de un registro que requieren revisión (se ven en preview).
export const reviewFlags = (flags = []) => flags.filter((f) => BLOCKING_FLAG_RE.test(f));
export const flagsPv = (flags = []) => reviewFlags(flags).map((f) => pv(f.length > 150 ? `${f.slice(0, 147)}…` : f, f)).join(' ');

export const each = (arr, fn) => (arr || []).map(fn).join('');
export function groupBy(arr, fn) {
  const m = new Map();
  for (const x of arr) {
    const k = fn(x);
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(x);
  }
  return [...m];
}
export const byYearDesc = (get = (x) => x.year) => (a, b) => (get(b) ?? -1) - (get(a) ?? -1);

export const isExternal = (u) => /^https?:\/\//.test(u || '');
export const ext = (url, label, cls = '') =>
  url ? `<a${cls ? ` class="${cls}"` : ''} href="${esc(url)}" target="_blank" rel="noopener">${label} ↗</a>` : label;

const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
export function shortDate(iso) {
  if (!iso) return '';
  const [y, m, d] = String(iso).split('-');
  if (!m) return y;
  return `${d ? `${Number(d)} ` : ''}${MESES[Number(m) - 1]} ${y}`;
}
export const longDate = (d = new Date()) => `${d.getDate()} ${MESES[d.getMonth()]} ${d.getFullYear()}`;

export function yearsLabel(years, current) {
  const ys = (years || []).filter(Boolean);
  if (!ys.length) return current ? 'actualidad' : '';
  const a = Math.min(...ys);
  const b = Math.max(...ys);
  if (current) return `${a}–actualidad`;
  return a === b ? String(a) : `${a}–${b}`;
}

// ── Publicaciones ────────────────────────────────────────────────────────
export const AUTHOR_APA = 'Bárcena Juárez, S. A.';
export function apa(p) {
  // citation_cv ya trae "(año). Título. Medio…": se antepone la autoría y el DOI si falta.
  let c = plain(p.citation_cv || `(${p.year ?? 's. f.'}). ${p.title}. ${p.venue}.`).replace(/^\(none\)/, '(s. f.)');
  if (p.doi && !c.includes(p.doi)) c = `${c.replace(/\.?$/, '.')} https://doi.org/${p.doi}`;
  else if (!p.doi && p.url && !c.includes(p.url)) c = `${c.replace(/\.?$/, '.')} ${p.url}`;
  return `${AUTHOR_APA} ${c}`;
}
const bibEsc = (s) => plain(s).replace(/([{}&%$#_])/g, '\\$1');
const BIB_TYPE = { libro: 'book', articulo: 'article', capitulo: 'incollection' };
export function bibtex(pubs) {
  const out = ['% publications.bib · generado por scripts/build.mjs desde data/publications.json', ''];
  for (const p of pubs) {
    const t = BIB_TYPE[p.type] || 'misc';
    const venueKey = t === 'article' ? 'journal' : t === 'incollection' ? 'booktitle' : t === 'book' ? 'publisher' : 'howpublished';
    const f = [
      ['author', 'Bárcena Juárez, Sergio A.'],
      ['title', p.title],
      [venueKey, p.venue],
      ['year', p.year],
      ['pages', p.pages && p.pages.replace(/-/, '--')],
      ['address', p.publisher_place],
      ['isbn', p.isbn],
      ['doi', p.doi],
      ['url', p.url],
    ].filter(([, v]) => v != null && v !== '');
    out.push(`@${t}{${p.id},\n${f.map(([k, v]) => `  ${k.padEnd(9)} = {${bibEsc(v)}}`).join(',\n')}\n}\n`);
  }
  return out.join('\n');
}

// ── Conferencias: separa institución/evento del texto del CV sin inventar ─
export function parseTalk(t) {
  const text = t.text || '';
  if (!t.title || !text.includes(t.title)) return { title: text, inst: '' };
  const i = text.indexOf(t.title);
  let before = text.slice(0, i);
  let after = text.slice(i + t.title.length);
  const role = (t.role || '').replace(/[,.\s]+$/, '');
  if (role && before.startsWith(role)) before = before.slice(role.length);
  before = before
    .replace(/^[\s.,:]*(en\s+(el|la|los|las)?\s*)?/i, '')
    .replace(/[\s,.:]*(ponencia|conferencia|panel|mesa|con la ponencia|con la conferencia)?\s*:?\s*["“«]?\s*$/i, '')
    .trim();
  after = after
    .replace(/^["”»]?\s*[,.:]?\s*/, '')
    .replace(/[\s,.]*\(?\b(19|20)\d{2}\)?\.?\s*$/, '')
    .trim();
  const inst = [before, after].filter(Boolean).join(', ').replace(/^./, (c) => c.toUpperCase());
  return { title: t.title, inst };
}
export const isVideo = (u) => /youtube\.com|youtu\.be|vimeo\.com|fb\.watch|facebook\.com\/.*\/videos|facebook\.com\/watch/i.test(u || '');

// ── IA: filtro por palabras clave en el título ───────────────────────────
export const IA_RE = /\b(IA|AI)\b|inteligencia artificial|artificial intelligence|algoritm/i;

// ── Iconos de línea (mismo trazo que pacomendez.mx) ──────────────────────
export const ICONS = {
  mail: '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5.5" width="18" height="13" rx="1"/><path d="m3.5 6.5 8.5 6.5 8.5-6.5"/></svg>',
  download: '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4v11m-4.5-4.5L12 15l4.5-4.5M5 19.5h14"/></svg>',
  down: '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14m-5-5 5 5 5-5"/></svg>',
  orcid: '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M9 10.5V16M9 8v.01M12.5 8.5V16h1.5a3.5 3.75 0 0 0 0-7.5z"/></svg>',
  scholar: '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M2.5 9.5 12 4.5l9.5 5-9.5 5z"/><path d="M6.5 11.6V16c1.5 1.6 3.4 2.5 5.5 2.5s4-.9 5.5-2.5v-4.4M21.5 9.5V15"/></svg>',
  globe: '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.5 2.7 3.8 5.7 3.8 9s-1.3 6.3-3.8 9c-2.5-2.7-3.8-5.7-3.8-9S9.5 5.7 12 3z"/></svg>',
  book: '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5.5C6.5 4.5 9.5 4.5 12 6c2.5-1.5 5.5-1.5 8-.5v13c-2.5-1-5.5-1-8 .5-2.5-1.5-5.5-1.5-8-.5z"/><path d="M12 6v13"/></svg>',
  building: '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M3.5 20.5h17M5 20.5v-10l7-5 7 5v10M9 20.5v-5h6v5"/></svg>',
};
