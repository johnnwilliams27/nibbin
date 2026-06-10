import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  resolve: {
    alias: {
      '@nibbin/creatures': fileURLToPath(new URL('./packages/creatures/src/index.ts', import.meta.url)),
      '@nibbin/shared': fileURLToPath(new URL('./packages/shared/src/index.ts', import.meta.url)),
    },
  },
  test: {
    include: [
      'packages/*/test/**/*.test.ts',
      'apps/*/test/**/*.test.ts',
      'apps/*/lib/**/*.test.ts',
      'tests/**/*.test.ts',
    ],
  },
});
