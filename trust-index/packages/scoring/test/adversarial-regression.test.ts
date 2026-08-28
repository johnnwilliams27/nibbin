/**
 * Regressions for defects found in the adversarial review pass. Each test
 * pins a fix so it cannot silently revert. Fixtures are loaded and mutated
 * in memory; nothing on disk is touched.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { AgentSnapshot } from "@trust-index/types";
import { score } from "../src/index.js";
import { inputsHash } from "../src/hash.js";

function load(name: string): AgentSnapshot {
  const path = fileURLToPath(new URL(`../../../fixtures/snapshots/${name}.json`, import.meta.url));
  return JSON.parse(readFileSync(path, "utf8")) as AgentSnapshot;
}

describe("inputs_hash reproducibility (F5, F6)", () => {
  it("is invariant to feedback array order", () => {
    const a = load("strong-diverse");
    const b = load("strong-diverse");
    b.feedback.reverse();
    expect(inputsHash(a)).toBe(inputsHash(b));
    expect(score(a).result.score).toBe(score(b).result.score);
  });

  it("is invariant to equivalent decimal spellings of a constant", () => {
    const a = load("strong-diverse");
    const b = load("strong-diverse");
    b.constants.shrinkage_k.value = "5.000000000000";
    expect(a.constants.shrinkage_k.value).not.toBe(b.constants.shrinkage_k.value);
    expect(inputsHash(a)).toBe(inputsHash(b));
  });
});

describe("prototype-polluting tag1 (P1)", () => {
  it("does not throw when a feedback tag equals an inherited object member", () => {
    for (const tag of ["__proto__", "toString", "constructor", "hasOwnProperty"]) {
      const s = load("strong-diverse");
      for (const f of s.feedback) f.tag1 = tag;
      expect(() => score(s)).not.toThrow();
    }
  });
});

describe("duplicate feedback (F7)", () => {
  it("does not double-count a duplicated feedback row", () => {
    const base = load("thin-same-day-cohort");
    const dup = load("thin-same-day-cohort");
    dup.feedback.push({ ...dup.feedback[0]! });
    expect(score(dup).result.n_eff).toBe(score(base).result.n_eff);
  });
});

describe("missing reviewer row (F3)", () => {
  it("synthesizes a conservative reviewer and reports the count instead of throwing", () => {
    const s = load("thin-same-day-cohort");
    const victim = s.feedback[0]!.client_address;
    delete (s.reviewers as Record<string, unknown>)[victim];
    const { result } = score(s);
    expect(result.signals.synthesized_reviewer_count).toBe(1);
  });
});

describe("revoked-only history is not live (F9)", () => {
  it("an agent whose entire feedback history is revoked does not read live on that basis", () => {
    const s = load("strong-diverse");
    for (const f of s.feedback) f.is_revoked = true;
    s.validations = [];
    s.commerce = [];
    expect(score(s).result.lifecycle_state).not.toBe("live");
  });
});

describe("invalid prior provenance fails closed (logic-skeptic 2)", () => {
  it("rejects a prior with an unknown basis", () => {
    const s = load("strong-diverse");
    (s.priors as { basis: string }).basis = "raw_population_mean";
    expect(() => score(s)).toThrow();
  });

  it("rejects a prior value outside [0,1]", () => {
    const s = load("strong-diverse");
    s.priors.global = "1.500000";
    expect(() => score(s)).toThrow();
  });
});

describe("confidence is monotone across prior position (second-pass P0)", () => {
  function confAt(name: string, prior: string): number {
    const s = load(name);
    s.priors.global = prior;
    for (const k of Object.keys(s.priors.by_context)) s.priors.by_context[k] = prior;
    return score(s).result.confidence;
  }

  it("does not collapse a well-evidenced agent's confidence for a near-degenerate prior", () => {
    const mid = confAt("strong-diverse", "0.500000");
    for (const p of ["0.050000", "0.020000", "0.001000", "0.000000", "1.000000"]) {
      // Confidence tracks the posterior interval width, so it stays comparable
      // to the mid-prior value rather than crashing toward 0 near the edges.
      expect(confAt("strong-diverse", p)).toBeGreaterThan(mid - 0.2);
    }
  });

  it("never lets a thin agent outrank a strong agent on confidence", () => {
    expect(confAt("strong-diverse", "0.020000")).toBeGreaterThan(confAt("thin-same-day-cohort", "0.000000"));
  });
});

describe("future timestamps clamp rather than throw (second-pass P0, F4 completion)", () => {
  it("does not throw when registered_at is after as_of_ts", () => {
    const s = load("strong-diverse");
    s.registered_at = "2027-06-01T00:00:00Z";
    expect(() => score(s)).not.toThrow();
    expect(score(s).result.effective_history_days).toBe(0);
  });
});
