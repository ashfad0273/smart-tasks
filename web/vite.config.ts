import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));
const pkg = JSON.parse(readFileSync(here('../package.json'), 'utf8')) as { version: string };

/** Reuse the popup's index.html (same preloader) but boot the web entry, with the app manifest. */
const webEntry = (): Plugin => {
  let serve = false;
  return {
    name: 'smart-tasks-web-entry',
    configResolved: c => void (serve = c.command === 'serve'),
    transformIndexHtml: {
      order: 'pre',
      handler: html => {
        if (!html.includes('src="./main.tsx"')) throw new Error('popup index.html entry script not found');
        const entry = serve ? `/@fs/${encodeURI(here('./main.ts').replace(/\\/g, '/'))}` : '../../web/main.ts';
        return html
          .replace('src="./main.tsx"', `src="${entry}"`)
          .replace(
            '<title>Smart Tasks</title>',
            [
              '<title>Smart Tasks</title>',
              '<link rel="manifest" href="./manifest.webmanifest" />',
              '<link rel="icon" href="./icon-128.png" />',
              '<link rel="apple-touch-icon" href="./icon-512.png" />',
              '<meta name="theme-color" content="#10191c" />',
              '<meta name="mobile-web-app-capable" content="yes" />',
            ].join('\n    '),
          )
          .replace('width=device-width, initial-scale=1.0', 'width=device-width, initial-scale=1.0, viewport-fit=cover');
      },
    },
  };
};

export default defineConfig({
  root: here('../entrypoints/popup'),
  base: './',
  publicDir: here('./public'),
  plugins: [webEntry(), react(), tailwindcss()],
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  server: { port: 1430, strictPort: true },
  clearScreen: false,
  build: {
    outDir: here('./dist'),
    emptyOutDir: true,
    target: ['chrome110', 'safari16'],
    assetsInlineLimit: 8192,
  },
});
