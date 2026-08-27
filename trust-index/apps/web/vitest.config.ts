import { defineConfig } from "vitest/config";

// Explicit include: without it, config resolution escapes to the host repo
// above trust-index/ (see docs/NOTES-lead.md).
export default defineConfig({
  esbuild: { jsx: "automatic" },
  test: {
    include: ["test/**/*.test.ts", "test/**/*.test.tsx"],
    environment: "node",
  },
});
