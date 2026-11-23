import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath } from 'node:url';

// Builds the real popup UI as a plain web page (lib/ext.ts falls back to
// localStorage outside Chrome). scripts/inline.mjs then folds it into one
// self-contained app.html for the static desktop preview.
const root = fileURLToPath(new URL('../../entrypoints/popup', import.meta.url));

export default defineConfig({
  root,
  base: './',
  plugins: [react(), tailwindcss()],
  build: {
    outDir: fileURLToPath(new URL('./.build', import.meta.url)),
    emptyOutDir: true,
    assetsInlineLimit: 100_000_000,
    cssCodeSplit: false,
    modulePreload: false,
    rollupOptions: { output: { inlineDynamicImports: true } },
  },
});
