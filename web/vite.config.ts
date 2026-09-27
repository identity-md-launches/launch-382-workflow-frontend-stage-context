import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// Static export for content-addressed hosting: relative base, single page, no server rewrites.
// The export lands at the repository root `dist/` and is committed together with the source.
export default defineConfig({
  base: './',
  plugins: [react()],
  build: {
    outDir: '../dist',
    emptyOutDir: true,
    sourcemap: false,
    target: 'es2022',
    modulePreload: { polyfill: false },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./test/setup.ts'],
    include: ['test/**/*.test.ts', 'test/**/*.test.tsx'],
    globals: false,
  },
});
