import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts", "src/**/*.test.ts"],
    globalSetup: ["./test/globalSetup.ts"],
    // Container start plus migration can take a while on first run.
    testTimeout: 60_000,
    hookTimeout: 120_000,
  },
});
