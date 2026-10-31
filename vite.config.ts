import { defineConfig } from 'vitest/config';

export default defineConfig({
  base: './',
  build: { target: 'es2022', outDir: 'dist', sourcemap: true },
  test: { include: ['tests/**/*.test.ts'], environment: 'node' },
});
