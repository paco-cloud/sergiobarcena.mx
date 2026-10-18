#!/usr/bin/env node
// Genera public/compartir.jpg (1200×630) con el estilo del sitio. Se corre a mano y se commitea:
// el build de Pages no tiene Chrome. Sin Chrome deja public/compartir.svg como respaldo.
// Uso: node scripts/og-image.mjs
import { writeFile, mkdtemp, rm, access } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
<rect width="1200" height="630" fill="#fff"/>
<rect x="0" y="0" width="1200" height="630" fill="none" stroke="#e3e3e3" stroke-width="2"/>
<text x="80" y="150" font-family="Menlo, ui-monospace, monospace" font-size="22" font-weight="500" letter-spacing="3" fill="#C8102E">PODER LEGISLATIVO / ELECCIONES / IA</text>
<text x="74" y="330" font-family="-apple-system, 'Helvetica Neue', Helvetica, Arial, sans-serif" font-size="112" font-weight="200" letter-spacing="-3" fill="#1a1a1a">SERGIO A.</text>
<text x="74" y="450" font-family="-apple-system, 'Helvetica Neue', Helvetica, Arial, sans-serif" font-size="112" font-weight="200" letter-spacing="-3" fill="#1a1a1a">BÁRCENA</text>
<line x1="80" y1="500" x2="1120" y2="500" stroke="#d9d9d9" stroke-width="2"/>
<text x="80" y="550" font-family="-apple-system, 'Helvetica Neue', Helvetica, Arial, sans-serif" font-size="28" font-weight="300" fill="#4a4a4a">Tecnológico de Monterrey · UNAM · SNII nivel II</text>
<text x="1120" y="550" text-anchor="end" font-family="Menlo, ui-monospace, monospace" font-size="20" fill="#6b6b6b">sergiobarcena.mx</text>
</svg>`;

let chrome = true;
try {
  await access(CHROME);
} catch {
  chrome = false;
}
if (!chrome) {
  await writeFile(path.join(ROOT, 'public', 'compartir.svg'), svg);
  console.log('og-image: sin Chrome; se dejó public/compartir.svg (convertir a JPG antes de producción)');
  process.exit(0);
}
const dir = await mkdtemp(path.join(tmpdir(), 'og-'));
const html = path.join(dir, 'og.html');
const png = path.join(dir, 'og.png');
await writeFile(html, `<!doctype html><meta charset="utf-8"><style>html,body{margin:0}</style>${svg}`);
execFileSync(CHROME, ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--force-device-scale-factor=1', '--window-size=1200,630', `--screenshot=${png}`, `file://${html}`], { stdio: 'ignore' });
execFileSync('/usr/bin/sips', ['-s', 'format', 'jpeg', '-s', 'formatOptions', '85', png, '--out', path.join(ROOT, 'public', 'compartir.jpg')], { stdio: 'ignore' });
await rm(dir, { recursive: true, force: true });
console.log('og-image: public/compartir.jpg (1200×630)');
