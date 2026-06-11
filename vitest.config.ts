import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  resolve: {
    alias: {
      '@nibbin/creatures': fileURLToPath(new URL('./packages/creatures/src/index.ts', import.meta.url)),
      '@nibbin/shared': fileURLToPath(new URL('./packages/shared/src/index.ts', import.meta.url)),
      '@nibbin/router': fileURLToPath(new URL('./packages/router/src/index.ts', import.meta.url)),
      '@nibbin/keeper': fileURLToPath(new URL('./packages/keeper/src/index.ts', import.meta.url)),
    },
  },
  test: {
    include: [
      'packages/*/test/**/*.test.ts',
      'apps/*/test/**/*.test.ts',
      'apps/*/lib/**/*.test.ts',
      'tests/**/*.test.ts',
    ],
    // The RLS test files share one Postgres and each drops/recreates the public
    // schema in setup; running files in parallel races that reset. The suite is
    // small, so run files sequentially for determinism.
    fileParallelism: false,
  },
});
