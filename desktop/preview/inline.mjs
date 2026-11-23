// Folds the Vite build in .build/ into a single self-contained app.html.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const build = join(here, '.build');
let html = readFileSync(join(build, 'index.html'), 'utf8');

html = html.replace(/<link rel="stylesheet"[^>]*href="\.\/([^"]+)"[^>]*>/g, (_, p) =>
  `<style>${readFileSync(join(build, p), 'utf8')}</style>`,
);
html = html.replace(/<script type="module"[^>]*src="\.\/([^"]+)"[^>]*><\/script>/g, (_, p) => {
  const js = readFileSync(join(build, p), 'utf8').replace(/<\/script/gi, '<\\/script');
  // Run after <div id="root"> exists: module scripts are deferred anyway.
  return `<script type="module">${js}</script>`;
});

writeFileSync(join(here, 'app.html'), html);
console.log(`app.html: ${(Buffer.byteLength(html) / 1024).toFixed(0)} KB`);

// The Windows-frame page around it, with the app icon inlined.
const icon = 'data:image/png;base64,' + readFileSync(join(here, '../../public/icon/48.png')).toString('base64');
const page = readFileSync(join(here, 'preview.src.html'), 'utf8').replaceAll('__ICON__', icon);
writeFileSync(join(here, 'index.html'), page);
console.log('index.html written');
