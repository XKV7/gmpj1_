import { defineConfig } from 'vitest/config';

export default defineConfig({
  base: './',
  server: { host: true },
  build: { target: 'es2022', chunkSizeWarningLimit: 2000 },
  test: { environment: 'node', include: ['tests/**/*.test.ts'] },
});
