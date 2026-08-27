import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const here = path.dirname(fileURLToPath(import.meta.url));

// Explicit include: without it, config resolution escapes to the host repo
// above trust-index/ (see docs/NOTES-lead.md). The "@/*" alias mirrors
// tsconfig.json's paths mapping; Vite/Vitest do not read tsconfig paths on
// their own the way Next's compiler does.
export default defineConfig({
  esbuild: { jsx: "automatic" },
  resolve: {
    alias: {
      "@": path.join(here, "src"),
    },
  },
  test: {
    include: ["test/**/*.test.ts", "test/**/*.test.tsx"],
    environment: "node",
  },
});
