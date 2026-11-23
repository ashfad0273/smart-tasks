import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));
const pkg = JSON.parse(readFileSync(here('../package.json'), 'utf8')) as { version: string };

/** Reuse the popup's index.html (same preloader) but boot the desktop entry. */
const desktopEntry = (): Plugin => {
  let serve = false;
  return {
    name: 'smart-tasks-desktop-entry',
    configResolved: c => void (serve = c.command === 'serve'),
    // 'pre' runs before Vite collects the page's script entries.
    transformIndexHtml: {
      order: 'pre',
      handler: html => {
        if (!html.includes('src="./main.tsx"')) throw new Error('popup index.html entry script not found');
        // The dev server can't reach above its root by a relative URL: use its /@fs/ route.
        const entry = serve ? `/@fs/${encodeURI(here('./web/main.ts').replace(/\\/g, '/'))}` : '../../desktop/web/main.ts';
        return html.replace('src="./main.tsx"', `src="${entry}"`);
      },
    },
  };
};

export default defineConfig({
  root: here('../entrypoints/popup'),
  base: './',
  plugins: [desktopEntry(), react(), tailwindcss()],
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  server: { port: 1420, strictPort: true },
  clearScreen: false,
  build: {
    outDir: here('./dist'),
    emptyOutDir: true,
    target: ['chrome120', 'safari16'], // WebView2 (evergreen Chromium) on Windows, WKWebView on macOS 13+
    assetsInlineLimit: 8192,
  },
});
