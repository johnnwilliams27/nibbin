import { describe, expect, it } from "vitest";
import type { ReviewerSnapshot } from "@trust-index/types";
import { DEFAULT_CONSTANTS } from "@trust-index/types";
import { parseConstants } from "../src/constants.js";
import { computeReviewerWeights } from "../src/weights.js";
import { ONE, parseFx } from "../src/fixedmath.js";
import { parseIsoUtcSeconds } from "../src/time.js";

const AS_OF = parseIsoUtcSeconds("2026-08-01T00:00:00Z");
const c = parseConstants(DEFAULT_CONSTANTS);

function reviewer(overrides: Partial<ReviewerSnapshot>): ReviewerSnapshot {
  return {
    address: "0x0000000000000000000000000000000000000a",
    first_seen_block: 1,
    first_seen_ts: "2025-08-01T00:00:00Z", // exactly 365 days before as_of: full age ramp
    total_reviews: 1,
    distinct_agents_reviewed: 10,
    max_reviews_single_day: 1,
    funder_address: null,
    portfolio_top_funder_share: "0.0000",
    has_commerce_with_agent: false,
    ...overrides,
  };
}

describe("computeReviewerWeights", () => {
  it("a fully aged, diverse, solo reviewer gets the full 1.0 weight (all multipliers neutral)", () => {
    const [w] = computeReviewerWeights([reviewer({})], new Map([["0x0000000000000000000000000000000000000a", 1]]), AS_OF, c);
    expect(w!.weightFx).toBe(ONE);
    expect(w!.components.age).toBe(ONE);
    expect(w!.components.cohort).toBe(ONE);
    expect(w!.components.funder).toBe(ONE);
    expect(w!.components.velocity).toBe(ONE);
    expect(w!.components.commerce).toBe(ONE);
    expect(w!.components.portfolio).toBe(ONE);
  });

  it("a brand-new wallet (age 0) gets exactly the age floor", () => {
    const [w] = computeReviewerWeights(
      [reviewer({ first_seen_ts: "2026-08-01T00:00:00Z" })],
      new Map([["0x0000000000000000000000000000000000000a", 1]]),
      AS_OF,
      c,
    );
    expect(w!.components.age).toBe(parseFx("0.20"));
  });

  it("two reviewers created on the same day both take the full cohort penalty", () => {
    const a = reviewer({ address: "0x0000000000000000000000000000000000000a", first_seen_ts: "2026-07-31T12:00:00Z" });
    const b = reviewer({ address: "0x0000000000000000000000000000000000000b", first_seen_ts: "2026-07-31T13:00:00Z" });
    const weights = computeReviewerWeights(
      [a, b],
      new Map([
        ["0x0000000000000000000000000000000000000a", 1],
        ["0x0000000000000000000000000000000000000b", 1],
      ]),
      AS_OF,
      c,
    );
    // othersInWindow=1, total=2 (self included per docs/NOTES-track-b.md) -> share 0.5.
    for (const w of weights) {
      expect(w.components.cohort).toBe(ONE - (parseFx("0.5") * parseFx("0.90")) / ONE);
    }
  });

  it("a reviewer sharing a funder with another reviewer of this agent gets the common-funder multiplier", () => {
    const a = reviewer({ address: "0x0000000000000000000000000000000000000a", funder_address: "0x0000000000000000000000000000000000000f" });
    const b = reviewer({ address: "0x0000000000000000000000000000000000000b", funder_address: "0x0000000000000000000000000000000000000f" });
    const weights = computeReviewerWeights(
      [a, b],
      new Map([
        ["0x0000000000000000000000000000000000000a", 1],
        ["0x0000000000000000000000000000000000000b", 1],
      ]),
      AS_OF,
      c,
    );
    for (const w of weights) expect(w.components.funder).toBe(parseFx("0.25"));
  });

  it("a reviewer past the velocity threshold gets the velocity multiplier", () => {
    const [w] = computeReviewerWeights(
      [reviewer({ max_reviews_single_day: 51 })],
      new Map([["0x0000000000000000000000000000000000000a", 1]]),
      AS_OF,
      c,
    );
    expect(w!.components.velocity).toBe(parseFx("0.30"));
  });

  it("a reviewer exactly at the velocity threshold is not penalized (strict >)", () => {
    const [w] = computeReviewerWeights(
      [reviewer({ max_reviews_single_day: 50 })],
      new Map([["0x0000000000000000000000000000000000000a", 1]]),
      AS_OF,
      c,
    );
    expect(w!.components.velocity).toBe(ONE);
  });

  it("repeat interaction compounds: repeat_bonus_multiplier^(count-1), capped", () => {
    const [w] = computeReviewerWeights(
      [reviewer({})],
      new Map([["0x0000000000000000000000000000000000000a", 4]]),
      AS_OF,
      c,
    );
    // 1.15^3 = 1.520875, above the 1.50 cap.
    expect(w!.components.repeat).toBe(parseFx("1.50"));
  });

  it("a single review (count=1) gets no repeat bonus", () => {
    const [w] = computeReviewerWeights(
      [reviewer({})],
      new Map([["0x0000000000000000000000000000000000000a", 1]]),
      AS_OF,
      c,
    );
    expect(w!.components.repeat).toBe(ONE);
  });

  it("commerce corroboration applies the commerce multiplier", () => {
    const [w] = computeReviewerWeights(
      [reviewer({ has_commerce_with_agent: true })],
      new Map([["0x0000000000000000000000000000000000000a", 1]]),
      AS_OF,
      c,
    );
    expect(w!.components.commerce).toBe(parseFx("1.60"));
  });

  it("portfolio concentration applies the portfolio penalty proportionally", () => {
    const [w] = computeReviewerWeights(
      [reviewer({ portfolio_top_funder_share: "1.0000" })],
      new Map([["0x0000000000000000000000000000000000000a", 1]]),
      AS_OF,
      c,
    );
    expect(w!.components.portfolio).toBe(ONE - parseFx("0.70"));
  });

  it("final weight is clamped at the ceiling of 1.0 even when up-weights push the product above it", () => {
    const [w] = computeReviewerWeights(
      [reviewer({ has_commerce_with_agent: true })],
      new Map([["0x0000000000000000000000000000000000000a", 3]]), // repeat bonus stacks on top of commerce
      AS_OF,
      c,
    );
    expect(w!.weightFx).toBe(ONE);
  });

  it("final weight never drops below the weight floor even under maximal down-weighting", () => {
    const worst = reviewer({
      first_seen_ts: "2026-08-01T00:00:00Z",
      funder_address: "0x0000000000000000000000000000000000000f",
      max_reviews_single_day: 999,
      portfolio_top_funder_share: "1.0000",
    });
    const other = reviewer({ address: "0x0000000000000000000000000000000000000b", first_seen_ts: "2026-08-01T00:30:00Z", funder_address: "0x0000000000000000000000000000000000000f" });
    const weights = computeReviewerWeights(
      [worst, other],
      new Map([
        ["0x0000000000000000000000000000000000000a", 1],
        ["0x0000000000000000000000000000000000000b", 1],
      ]),
      AS_OF,
      c,
    );
    const w = weights.find((x) => x.address === worst.address)!;
    expect(w.weightFx).toBe(c.weightFloor);
  });

  it("output is sorted by address regardless of input order", () => {
    const a = reviewer({ address: "0x0000000000000000000000000000000000000b" });
    const b = reviewer({ address: "0x0000000000000000000000000000000000000a" });
    const weights = computeReviewerWeights(
      [a, b],
      new Map([
        ["0x0000000000000000000000000000000000000a", 1],
        ["0x0000000000000000000000000000000000000b", 1],
      ]),
      AS_OF,
      c,
    );
    expect(weights.map((w) => w.address)).toEqual([
      "0x0000000000000000000000000000000000000a",
      "0x0000000000000000000000000000000000000b",
    ]);
  });

  it("missing repeat count (reviewer not in the map) defaults to zero occurrences", () => {
    const [w] = computeReviewerWeights([reviewer({})], new Map(), AS_OF, c);
    expect(w!.components.repeat).toBe(ONE);
  });

  it("a first_seen after as_of clamps age to zero rather than going negative", () => {
    const [w] = computeReviewerWeights(
      [reviewer({ first_seen_ts: "2026-12-01T00:00:00Z" })],
      new Map([["0x0000000000000000000000000000000000000a", 1]]),
      AS_OF,
      c,
    );
    expect(w!.components.age).toBe(parseFx("0.20"));
  });
});
