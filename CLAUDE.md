# sergiobarcena.mx · CLAUDE.md

Sitio académico-profesional del Dr. Sergio A. Bárcena Juárez. Opera Paco Méndez
(Novomedia Estudios). El contenido lo define el asistente "sergiobarcena.mx"; esta
sesión solo construye.

## Reglas de trabajo
- Rama por ticket (sbj-code-0N, sbj-web-0N). Primero staging (preview de Pages);
  producción solo con el "sí" de Paco. Nunca merge ni push a main sin ese "sí".
- El token de GitHub está en el Keychain de macOS; Claude no lo lee ni lo pide.
- Mac sin Homebrew ni gh. Node en ~/.local/node. Claude CLI en ~/.local/bin/claude.
- Sesiones concurrentes: usa `git worktree`, commitea solo tus rutas y revisa
  `find . -mmin -45 -not -path './.git/*'` antes de editar archivos compartidos.
- `npm run build` debe terminar con 0 errores y 0 avisos antes de cada commit.
- No inventes contenido. Lo que falte se queda como [POR VERIFICAR] visible en preview
  y bloquea producción (validate falla en main si queda alguno).
- Formularios sin backend muestran "[PENDIENTE INTEGRACIÓN FORMULARIO/CRM]" y nunca
  simulan un envío exitoso.
- Neutralidad política: el sitio no agrega opinión a los titulares de prensa.

## Stack
- HTML/CSS/JS estático generado por `scripts/build.mjs` desde `data/*.json` y
  `templates/*.html` (template literals; sin frameworks, sin dependencias en runtime).
- Sistema visual derivado de pacomendez.mx (SBJ-CODE-02): sans y mono del sistema, sin
  fuentes web, sin modo oscuro, sidebar numerada 00–09 en desktop y menú a pantalla
  completa en móvil. El repo de pacomendez.mx es solo referencia: nunca se edita.
- Sin cookies de rastreo; analítica: Cloudflare Web Analytics (desactivada hasta decisión).
- Prensa: `npm run check-press` lee `data/raw/press_*.json`, revisa cada URL (y Wayback,
  sin "Save Page Now") y escribe `data/press.json` + `reports/*.csv`. El build solo publica
  las notas que pasan el filtro de `scripts/lib/press.mjs`.
- `public/compartir.jpg` se regenera a mano con `node scripts/og-image.mjs` (usa Chrome local).
- Imágenes: AVIF/WebP con srcset y width/height. EXIF/GPS eliminado.
- Hosting: Cloudflare Pages (cuenta Novomedia). Salida en `dist/`.
  `_headers` (CSP estricta, HSTS, X-Content-Type-Options, Referrer-Policy) y
  `_redirects` (www → apex 301, /cv → /semblanza#cv). Previews con `X-Robots-Tag: noindex`.

## Estructura
.
├── CLAUDE.md
├── package.json            # scripts: build, validate, dev, check-links
├── wrangler.toml           # name="sergiobarcena-mx", pages_build_output_dir="dist"
├── data/
│   ├── profile.json        # nombre, cargo, semblanzas corta/larga, perfiles (ORCID, Scholar…)
│   ├── publications.json   # + publications.bib
│   ├── press.json
│   ├── talks.json
│   ├── teaching.json
│   ├── research.json
│   └── awards.json
├── templates/              # layout.html + una plantilla por ruta
├── assets/{css,js,fonts,img}
├── scripts/{build.mjs,validate.mjs,check-links.mjs}
├── public/                 # _headers, _redirects, robots.txt, favicon, cv.pdf
└── dist/                   # generado; no se commitea

## Esquemas mínimos (validate.mjs los exige)
- publication: id, type(libro|articulo|capitulo|divulgacion|traduccion|documento),
  year, title, authors[], venue, url|doi, refereed(bool), topics[], lang
- press: id, date(YYYY-MM-DD), outlet, title, url, format(texto|video|audio|redes),
  kind(entrevista|cita|datos_buro|columna|institucional|sindicada|redes),
  topics[], syndicated_urls[]?, archive_url?
- talk: id, year, title, institution, city, country, role, url?
- award: id, year, name, grantor, url?, evidence(enlace|constancia)
- research: id, title, role, partners[], period, url?
- teaching: id, kind(materia|curso|posgrado|tesis), title, institution, years, level?

## validate.mjs falla si…
- hay una URL con "safelinks.protection.outlook.com"
- hay una URL duplicada en press.json (las sindicadas van en syndicated_urls)
- falta un campo obligatorio, una fecha es inválida o un enlace interno está roto
- hay segunda persona en textos públicos (/\btu (libro|investigaci|trabajo|análisis)/i)
- hay [POR VERIFICAR] en una build con BRANCH=main
- aparece el teléfono del CV o cualquier patrón +52 (55)

## SEO
- lang es-MX (y en en /en/), title "Sergio A. Bárcena · Poder Legislativo, elecciones e IA",
  canonical, OG/Twitter por página.
- JSON-LD Person: name, alternateName, jobTitle, affiliation (Tecnológico de Monterrey),
  alumniOf (UNAM), sameAs (ORCID, Scholar, ResearcherID, Academia.edu, página Tec).
- JSON-LD Book/ScholarlyArticle en /publicaciones. sitemap.xml y robots.txt.

## Calidad
Lighthouse ≥ 95 ×4 · AA · teclado · foco visible · aria-current en nav ·
prefers-reduced-motion · peso < 300 KB sin imágenes · sin CLS.
