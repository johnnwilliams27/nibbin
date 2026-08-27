/**
 * SPEC 22 verification gate: the same snapshot scored in two SEPARATE
 * processes must produce byte-identical ScoreResult JSON. Two different
 * physical machines/OSes are unavailable in this build environment; this
 * test substitutes two separate child `node` processes as the closest
 * available approximation and notes the gap here per protocol.
 *
 * This file is one of the two places in packages/scoring that imports
 * node:child_process; the workspace eslint config currently bans I/O
 * imports across all of packages/scoring/**, so this file (like src/cli.ts)
 * needs an eslint exemption the lead has been asked for in
 * docs/NOTES-track-b.md. It does not affect `pnpm test` (vitest, not
 * eslint, is the gate this track owns).
 */
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const scriptPath = fileURLToPath(new URL("../scripts/print-canonical.ts", import.meta.url));
const cwd = fileURLToPath(new URL("..", import.meta.url));

function runInChildProcess(): string {
  return execFileSync(process.execPath, ["--import", "tsx/esm", scriptPath], {
    cwd,
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
  });
}

describe("determinism harness (SPEC 22, gate B2)", () => {
  it("two separate child processes produce byte-identical canonical output for every fixture", () => {
    const first = runInChildProcess();
    const second = runInChildProcess();
    expect(first).toBe(second);

    const parsed = JSON.parse(first) as Record<string, string>;
    expect(Object.keys(parsed).length).toBe(10);
  }, 30_000);
});
