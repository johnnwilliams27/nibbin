#!/usr/bin/env node
// Thin launcher for `agent-trust` (UC-6). This package ships from TypeScript
// source with no build step (see package.json "main"): this file registers
// tsx's ESM loader in-process, the same mechanism scripts/generate-golden.ts
// already relies on via the tsx CLI, then hands off to src/cli.ts. No
// scoring logic lives here.
import { register } from "node:module";
import { pathToFileURL } from "node:url";

register("tsx/esm", pathToFileURL("./"));

await import(new URL("../src/cli.ts", import.meta.url).href);
