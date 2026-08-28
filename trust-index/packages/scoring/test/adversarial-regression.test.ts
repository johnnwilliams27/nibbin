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
});
