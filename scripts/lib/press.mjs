// Reglas compartidas de prensa: normalización de URLs y filtro de publicación (SBJ-CODE-02 §7.4).

// Parámetros de query que identifican el contenido y no se pueden descartar al comparar.
const ID_PARAMS = new Set(['v', 'id', 'p', 'fbid', 'story_fbid', 'item', 'nota', 'idnota', 'article', 'publicacion', 'set_entry']);

// Dominio + ruta, sin www, sin barra final, sin fragmento, sin utm_* ni parámetros de rastreo.
export function normUrl(u) {
  try {
    const x = new URL(u);
    const keep = [...x.searchParams].filter(([k]) => ID_PARAMS.has(k.toLowerCase())).sort(([a], [b]) => a.localeCompare(b));
    const q = keep.length ? `?${keep.map(([k, v]) => `${k}=${v}`).join('&')}` : '';
    return `${x.hostname.replace(/^www\./, '').toLowerCase()}${decodeURI(x.pathname).replace(/\/+$/, '')}${q}`;
  } catch {
    return String(u);
  }
}

export const isPacoProject = (n) => (n.flags || []).some((f) => /Proyecto de Paco/i.test(f)) && !n.paco_resolved;

// Devuelve los motivos por los que una nota NO entra al HTML (vacío = publicable).
export function pressBlockers(n) {
  const out = [];
  if (n.dup_of) out.push(`duplicado de ${n.dup_of}`);
  if (!(n.http_status === 200 || n.archive_url)) out.push(`sin 200 ni archivo (${n.http_status ?? 'sin revisar'})`);
  if (!n.title) out.push('sin título');
  if (!n.outlet) out.push('sin medio');
  if (!n.date || !/^\d{4}-\d{2}/.test(n.date)) out.push('fecha sin mes');
  if (!n.kind) out.push('tipo pendiente');
  if (isPacoProject(n)) out.push('proyecto de Paco sin rol definido (§8.6)');
  return out;
}

export const isPublishable = (n) => pressBlockers(n).length === 0;
