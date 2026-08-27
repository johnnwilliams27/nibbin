/**
 * Gate: fixtures/manifest.json invariants, one describe block per fixture
 * case (SPEC 18.0, task protocol). Track B originally found that the
 * manifest's "thin" and "strong" tier expectations for thin-same-day-cohort
 * and strong-diverse did not hold under the literal SPEC 11.2/11.4 formulas
 * with the v0.1.0 provisional constants; the lead then retuned those two
 * fixtures at integration (older wallets and a lower portfolio share for
 * the cohort case, recent feedback and more aged reviewers for the strong
 * case) so both tiers are genuinely exercised. The original shortfall
 * arithmetic is preserved in NOTES-track-b.md, "Fixture invariant
 * mismatches". Track agents never edit fixtures (protocol); the lead owns
 * them.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { AgentSnapshot } from "@trust-index/types";
import { SUPPRESSION_REASONS } from "@trust-index/types";
import { score } from "../src/index.js";

const root = fileURLToPath(new URL("../../../", import.meta.url));

function load(name: string): AgentSnapshot {
  return JSON.parse(readFileSync(`${root}fixtures/snapshots/${name}.json`, "utf8")) as AgentSnapshot;
}

describe("placeholder (UC-4, SPEC 11.7)", () => {
  const { result } = score(load("placeholder"));
  it("lifecycle_state = placeholder", () => expect(result.lifecycle_state).toBe("placeholder"));
  it("score, score_low, score_high all null", () => {
    expect(result.score).toBeNull();
    expect(result.score_low).toBeNull();
    expect(result.score_high).toBeNull();
  });
  it("coverage_tier = none", () => expect(result.coverage_tier).toBe("none"));
  it("suppression_reason references placeholder", () =>
    expect(result.suppression_reason).toBe(SUPPRESSION_REASONS.placeholder));
});

describe("registered-no-history (SPEC 11.7/11.8)", () => {
  const { result } = score(load("registered-no-history"));
  it("lifecycle_state = registered", () => expect(result.lifecycle_state).toBe("registered"));
  it("score null with n_eff = 0", () => {
    expect(result.score).toBeNull();
    expect(result.n_eff).toBe(0);
  });
  it("coverage_tier = none", () => expect(result.coverage_tier).toBe("none"));
});

describe("thin-same-day-cohort (UC-1, SPEC 11.0/11.2)", () => {
  const { result } = score(load("thin-same-day-cohort"));

  it("n_eff well below raw review count of 6", () => expect(result.n_eff).toBeLessThan(6));

  it("signals.reviewer_cohort_same_day = 1.0000", () =>
    expect(result.signals.reviewer_cohort_same_day).toBe(1));

  // The lead retuned this fixture at integration (wallet ages past the ramp,
  // portfolio share 0.6) so the case exercises the thin tier as UC-1
  // intends, instead of falling under the suppression floor as the original
  // 20-day-old-wallet variant did (that arithmetic is preserved in
  // NOTES-track-b.md).
  it("coverage_tier = thin", () => {
    expect(result.coverage_tier).toBe("thin");
  });

  it("score strictly between prior*100 and the raw mean", () => {
    // prior 0.55 -> 55; raw mean of five 5s and one 4 on the 1-5 scale is
    // 0.9583 -> 95.83.
    expect(result.score).not.toBeNull();
    expect(result.score!).toBeGreaterThan(55);
    expect(result.score!).toBeLessThan(95.83);
  });

  it("interval width > 20 points", () => {
    expect(result.score_high! - result.score_low!).toBeGreaterThan(20);
  });
});

describe("transferred-identity (UC-2, SPEC 11.6)", () => {
  const { result } = score(load("transferred-identity"));
  it("ownership_epoch = 1", () => expect(result.ownership_epoch).toBe(1));
  it("signals.pre_transfer_reputation_excluded = true", () =>
    expect(result.signals.pre_transfer_reputation_excluded).toBe(true));
  it("effective_history_days = 11", () => expect(result.effective_history_days).toBe(11));
  it("pre-transfer feedback (40 entries) not counted in any context feedback_count", () => {
    const total = Object.values(result.scores_by_context).reduce((sum, c) => sum + c.feedback_count, 0);
    expect(total).toBe(3);
  });
});

describe("custody-migration (SPEC 11.6 known limitation)", () => {
  const { result } = score(load("custody-migration"));
  it("ownership_epoch = 0", () => expect(result.ownership_epoch).toBe(0));
  it("signals.custody_migration_detected = true", () =>
    expect(result.signals.custody_migration_detected).toBe(true));
  it("all 43 feedback entries eligible", () => {
    const total = Object.values(result.scores_by_context).reduce((sum, c) => sum + c.feedback_count, 0);
    expect(total).toBe(43);
  });
});

describe("strong-diverse (SPEC 11.5)", () => {
  const { result } = score(load("strong-diverse"));
  const { result: thinResult } = score(load("thin-same-day-cohort"));

  // The lead retuned this fixture at integration (recent feedback within a
  // 107-day span, 38 reviewers past the age ramp) so the case clears the
  // strong n_eff floor under decay; the original variant's shortfall
  // arithmetic is preserved in NOTES-track-b.md.
  it("n_eff >= 25", () => {
    expect(result.n_eff).toBeGreaterThanOrEqual(25);
  });

  it("coverage_tier = strong", () => {
    expect(result.coverage_tier).toBe("strong");
  });

  it("interval is narrower than thin-same-day-cohort's", () => {
    const width = result.score_high! - result.score_low!;
    const thinWidth = thinResult.score_high! - thinResult.score_low!;
    expect(width).toBeLessThan(thinWidth);
    expect(result.confidence).toBeGreaterThan(thinResult.confidence);
  });

  it("lifecycle_state = live", () => expect(result.lifecycle_state).toBe("live"));
});

describe("common-funder-ring (SPEC 11.2)", () => {
  const { result } = score(load("common-funder-ring"));
  it("signals.common_funder_share = 1.0000", () => expect(result.signals.common_funder_share).toBe(1));
  it("n_eff far below 20", () => expect(result.n_eff).toBeLessThan(20));
  it("no reviewer weight is 0 (floor 0.01)", () => {
    for (const w of result.reviewer_weights) expect(w.weight).toBeGreaterThanOrEqual(0.01);
  });
});

describe("bulk-reviewer (UC-3, SPEC 11.2)", () => {
  const { result } = score(load("bulk-reviewer"));
  const bulkAddress = "0x000000000000000000000000000000000000b111";
  it("bulk wallet weight < every ordinary reviewer weight", () => {
    const bulk = result.reviewer_weights.find((w) => w.address === bulkAddress)!;
    for (const w of result.reviewer_weights) {
      if (w.address === bulkAddress) continue;
      expect(bulk.weight).toBeLessThan(w.weight);
    }
  });
  it("bulk wallet weight >= 0.01", () => {
    const bulk = result.reviewer_weights.find((w) => w.address === bulkAddress)!;
    expect(bulk.weight).toBeGreaterThanOrEqual(0.01);
  });
});

describe("unparseable-scale (SPEC 11.10)", () => {
  const { result } = score(load("unparseable-scale"));
  it("score null", () => expect(result.score).toBeNull());
  it("suppression_reason references no usable feedback", () =>
    expect(result.suppression_reason).toBe(SUPPRESSION_REASONS.no_usable_feedback));
  it("signals.unusable_feedback_count = 3", () => expect(result.signals.unusable_feedback_count).toBe(3));
});

describe("dormant (SPEC 11.7)", () => {
  const { result } = score(load("dormant"));
  it("lifecycle_state = dormant", () => expect(result.lifecycle_state).toBe("dormant"));
  it("score present (evidence decayed, not erased)", () => expect(result.score).not.toBeNull());
});
