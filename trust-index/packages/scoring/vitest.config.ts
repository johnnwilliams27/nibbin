import { defineConfig } from "vitest/config";

// This package MUST carry its own vitest config with an explicit include:
// config resolution otherwise escapes to the host repo above trust-index/.
export default defineConfig({
  test: {
    include: ["src/**/*.test.ts", "test/**/*.test.ts"],
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: ["src/**/*.test.ts", "src/cli.ts", "src/index.ts"],
      // Gate B1: 100% branch coverage on lifecycle classification and
      // coverage tier modules, enforced per file.
      thresholds: {
        "**/src/lifecycle.ts": { branches: 100 },
        "**/src/tiers.ts": { branches: 100 },
      },
    },
  },
});
