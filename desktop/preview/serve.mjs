// Tiny static server for the preview: node desktop/preview/serve.mjs → http://localhost:4317
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { dirname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.PORT) || 4317;

createServer(async (req, res) => {
  const path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^([/\\])+/, '');
  try {
    const body = await readFile(join(here, path || 'index.html'));
    res.writeHead(200, { 'Content-Type': path.endsWith('.png') ? 'image/png' : 'text/html; charset=utf-8' });
    res.end(body);
  } catch {
    res.writeHead(404).end('Not found');
  }
}).listen(port, () => console.log(`Preview: http://localhost:${port}`));
