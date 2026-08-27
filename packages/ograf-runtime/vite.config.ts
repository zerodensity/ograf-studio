import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

// Produces a single self-contained ESM bundle (GSAP inlined, no external imports) that
// packages/codegen embeds — via a `?raw` import — into every exported package's main.js, and
// that the in-app preview harness also loads, so preview and export can never diverge.
export default defineConfig({
  build: {
    lib: {
      entry: fileURLToPath(new URL('./src/index.ts', import.meta.url)),
      formats: ['es'],
      fileName: () => 'graphic-runtime.js',
    },
    outDir: 'dist',
    emptyOutDir: true,
    minify: false,
  },
});
