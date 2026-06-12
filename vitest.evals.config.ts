import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

/**
 * The eval suite (M6.5) — `npm run evals`. Separate from `npm test` on
 * purpose: evals call the real model API and cost real money. They gate
 * model swaps and prompt changes (SPEC §9 decision log), not every PR.
 * CI runs them when ANTHROPIC_API_KEY is present in the environment;
 * NIBBIN_REQUIRE_EVALS=1 turns a missing key into a failure instead of a
 * skip (set it on the model-change workflow so the gate cannot silently
 * pass by missing credentials).
 */
export default defineConfig({
  resolve: {
    alias: {
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
    include: ['tests/evals/**/*.eval.ts'],
    fileParallelism: false,
    testTimeout: 90_000,
    hookTimeout: 90_000,
  },
});
