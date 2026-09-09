#!/usr/bin/env node
// Thin launcher for `agent-trust` (UC-6). This package ships from TypeScript
// source with no build step (see package.json "main"): this file re-execs
// node with tsx's ESM loader registered via --import, then hands off to
// src/cli.ts, mirroring the tsx-driven scripts/generate-golden.ts pattern
// already used in this package. No scoring logic lives here.
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const cliEntry = fileURLToPath(new URL("../src/cli.ts", import.meta.url));

const result = spawnSync(process.execPath, ["--import", "tsx/esm", cliEntry, ...process.argv.slice(2)], {
  stdio: "inherit",
});

process.exit(result.status ?? 1);
