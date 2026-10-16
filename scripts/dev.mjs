#!/usr/bin/env node
// Servidor local de dist/ con URLs limpias, como Cloudflare Pages. Solo para desarrollo.
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DIST = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist');
const PORT = Number(process.env.PORT) || 4321;
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml', '.xml': 'application/xml', '.txt': 'text/plain; charset=utf-8', '.bib': 'text/plain; charset=utf-8',
  '.json': 'application/json', '.woff2': 'font/woff2', '.avif': 'image/avif', '.webp': 'image/webp', '.pdf': 'application/pdf',
};
const isFile = async (p) => (await stat(p).catch(() => null))?.isFile();

createServer(async (req, res) => {
  const urlPath = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  const base = path.join(DIST, path.normalize(urlPath));
  if (!base.startsWith(DIST)) return res.writeHead(400).end();
  const candidates = urlPath.endsWith('/') ? [path.join(base, 'index.html')] : [base, `${base}.html`, path.join(base, 'index.html')];
  let file = null;
  for (const c of candidates) if (await isFile(c)) { file = c; break; }
  const status = file ? 200 : 404;
  file ??= path.join(DIST, '404.html');
  res.writeHead(status, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
  res.end(await readFile(file));
}).listen(PORT, () => console.log(`dev: http://localhost:${PORT}`));
