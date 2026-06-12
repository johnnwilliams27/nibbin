import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  resolve: {
    alias: {
      // Next's build-time RSC guard throws on import outside react-server
      // conditions; under tests it is inert so server-only lib modules
      // (engine, synthesis, drafting) stay unit-testable.
      'server-only': fileURLToPath(new URL('./tests/server-only-stub.ts', import.meta.url)),
      '@nibbin/creatures': fileURLToPath(new URL('./packages/creatures/src/index.ts', import.meta.url)),
      '@nibbin/shared': fileURLToPath(new URL('./packages/shared/src/index.ts', import.meta.url)),
      '@nibbin/router': fileURLToPath(new URL('./packages/router/src/index.ts', import.meta.url)),
      '@nibbin/keeper': fileURLToPath(new URL('./packages/keeper/src/index.ts', import.meta.url)),
      '@nibbin/drip': fileURLToPath(new URL('./packages/drip/src/index.ts', import.meta.url)),
      '@nibbin/email': fileURLToPath(new URL('./packages/email/src/index.ts', import.meta.url)),
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
