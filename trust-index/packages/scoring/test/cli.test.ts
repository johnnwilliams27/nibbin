/**
 * UC-6: `agent-trust recompute` end to end, via the real bin/agent-trust.mjs
 * launcher. Another of the small number of files in packages/scoring that
 * spawns a child process; see docs/NOTES-track-b.md for the eslint scoping
 * note (same rationale as test/determinism.test.ts and src/cli.ts).
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { score } from "../src/index.js";

const binPath = fileURLToPath(new URL("../bin/agent-trust.mjs", import.meta.url));
const snapshotPath = fileURLToPath(new URL("../../../fixtures/snapshots/bulk-reviewer.json", import.meta.url));

describe("agent-trust CLI (UC-6)", () => {
  it("--json prints exactly the engine's canonical bytes for the snapshot", () => {
    const out = execFileSync(process.execPath, [binPath, "recompute", "--snapshot", snapshotPath, "--json"], {
      encoding: "utf8",
    });
    const snapshot = JSON.parse(readFileSync(snapshotPath, "utf8"));
    const expected = score(snapshot).canonicalBytes;
    expect(out.trim()).toBe(expected);
  }, 15_000);

  it("without --json prints a readable derivation that ends with the canonical result", () => {
    const out = execFileSync(process.execPath, [binPath, "recompute", "--snapshot", snapshotPath], {
      encoding: "utf8",
    });
    expect(out).toContain("agent-trust recompute");
    expect(out).toContain("reviewer weights");
    expect(out).toContain("global");
    expect(out).toContain("canonical result");
  }, 15_000);

  it("exits non-zero with a usage message when --snapshot is missing", () => {
    expect(() => execFileSync(process.execPath, [binPath, "recompute"], { encoding: "utf8", stdio: "pipe" })).toThrow();
  }, 15_000);

  it("exits non-zero with a usage message for an unknown command", () => {
    expect(() => execFileSync(process.execPath, [binPath, "bogus"], { encoding: "utf8", stdio: "pipe" })).toThrow();
  }, 15_000);
});
