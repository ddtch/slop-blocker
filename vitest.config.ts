import path from 'node:path';
import { defineConfig } from 'vitest/config';

/**
 * Node environment by default; files that need a DOM opt in with a
 * `// @vitest-environment jsdom` comment on their first line.
 */
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    setupFiles: ['./test/setup.ts'],
    include: ['test/**/*.test.ts'],
  },
  resolve: {
    alias: { '@': path.resolve(import.meta.dirname, 'src') },
  },
});
