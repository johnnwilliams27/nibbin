/**
 * The refresh guard, which is the only thing standing between an unattended
 * weekly probe run and publishing our own outage as a population-wide finding.
 *
 * It is tested by running the real script as a subprocess rather than by
 * importing a helper, because what the workflow depends on is the EXIT CODE.
 * A guard that prints a refusal and exits 0 is worse than no guard: the job
 * goes green, the merge runs, and the log nobody reads contains the warning.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const SCRIPT = resolve(dirname(fileURLToPath(import.meta.url)), "../scripts/guard-refresh.mts");
const dir = mkdtempSync(join(tmpdir(), "guard-"));

/** An endpoint that answered: a completed MCP handshake. */
const answering = (endpoint: string): unknown => ({
  endpoint,
  mcp: { endpoint, handshake: { ok: true }, auth: null, rate_limit: null, attempts: [{ status: 200, reachable: true }] },
  a2a: null,
});

/** An endpoint that told us nothing: transport failure, no status at all. */
const silent = (endpoint: string): unknown => ({
  endpoint,
  mcp: { endpoint, handshake: { ok: false }, auth: null, rate_limit: null, attempts: [{ status: null, reason: "refused: ETIMEDOUT" }] },
  a2a: null,
});

/** 401. Rule 3: an auth wall is an answer and a rateable state, never silence. */
const authWalled = (endpoint: string): unknown => ({
  endpoint,
  mcp: { endpoint, handshake: { ok: false }, auth: { required: true, status: 401, scheme: null }, rate_limit: null, attempts: [{ status: 401 }] },
  a2a: null,
});

function file(name: string, results: unknown[]): string {
  const p = join(dir, name);
  writeFileSync(p, JSON.stringify({ results }));
  return p;
}

function run(args: string[]): { code: number; out: string } {
  try {
    const out = execFileSync("pnpm", ["exec", "tsx", SCRIPT, ...args], {
      cwd: resolve(dirname(fileURLToPath(import.meta.url)), ".."),
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { code: 0, out };
  } catch (e) {
    const err = e as { status?: number; stdout?: string };
    return { code: err.status ?? 1, out: err.stdout ?? "" };
  }
}

const many = (n: number, make: (e: string) => unknown, offset = 0): unknown[] =>
  Array.from({ length: n }, (_, i) => make(`https://host${i + offset}.test/mcp`));

describe("guard-refresh", () => {
  it("publishes an unchanged run", () => {
    const p = file("same.json", many(40, answering));
    const r = run(["--baseline", p, "--candidate", p]);
    expect(r.code).toBe(0);
    expect(r.out).toContain("OK to publish");
  });

  it("refuses when everything that answered last week goes silent", () => {
    const base = file("base-all.json", many(40, answering));
    const cand = file("cand-all.json", many(40, silent));
    const r = run(["--baseline", base, "--candidate", cand]);
    expect(r.code).toBe(1);
    expect(r.out).toContain("REFUSE");
  });

  it("publishes a loss small enough to be the population's own", () => {
    // 4 of 40 gone, i.e. 10%. Operators do go down, and saying so is the job.
    const base = file("base-few.json", many(40, answering));
    const cand = file("cand-few.json", [...many(36, answering), ...many(4, silent, 36)]);
    const r = run(["--baseline", base, "--candidate", cand]);
    expect(r.code).toBe(0);
    expect(r.out).toContain("OK to publish");
  });

  it("never counts an auth wall or a rate limit as silence", () => {
    // Every subject flipped to 401. That is a mass CHANGE but not a mass
    // silence — they all answered — so the guard must not fire. Rule 3.
    const base = file("base-auth.json", many(40, answering));
    const cand = file("cand-auth.json", many(40, authWalled));
    const r = run(["--baseline", base, "--candidate", cand]);
    expect(r.code).toBe(0);
  });

  it("refuses a sweep that did not finish, even if what it got looks healthy", () => {
    // 20 of 40 endpoints missing entirely. Every one present is fine, so a
    // regression ratio alone would wave this through and the merge would drop
    // half the index.
    const base = file("base-partial.json", many(40, answering));
    const cand = file("cand-partial.json", many(20, answering));
    const r = run(["--baseline", base, "--candidate", cand]);
    expect(r.code).toBe(1);
    expect(r.out).toContain("did not finish");
  });

  it("refuses a baseline path that was given but does not exist", () => {
    // The bug this replaces: a mistyped or wrongly-resolved path printed
    // "no baseline" and published unguarded, silently disabling the check.
    const cand = file("cand-typo.json", many(40, answering));
    const r = run(["--baseline", join(dir, "not-a-file.json"), "--candidate", cand]);
    expect(r.code).toBe(1);
    expect(r.out).toContain("no such file exists");
  });

  it("allows a genuine first run, when no baseline is passed at all", () => {
    const cand = file("cand-first.json", many(40, answering));
    const r = run(["--candidate", cand]);
    expect(r.code).toBe(0);
    expect(r.out).toContain("unguarded");
  });

  it("refuses an empty candidate rather than treating it as nothing to do", () => {
    const base = file("base-empty.json", many(40, answering));
    const cand = file("cand-empty.json", []);
    const r = run(["--baseline", base, "--candidate", cand]);
    expect(r.code).toBe(1);
    expect(r.out).toContain("no endpoints at all");
  });

  it("does not fire on a tiny baseline, where the ratio is noise", () => {
    // 3 of 5 silent is 60%, over the limit — but five endpoints cannot
    // distinguish our outage from three operators having a bad week.
    const base = file("base-tiny.json", many(5, answering));
    const cand = file("cand-tiny.json", [...many(2, answering), ...many(3, silent, 2)]);
    const r = run(["--baseline", base, "--candidate", cand]);
    expect(r.code).toBe(0);
  });
});
