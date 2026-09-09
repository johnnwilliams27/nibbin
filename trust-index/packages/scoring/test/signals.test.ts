import { describe, expect, it } from "vitest";
import type { ReviewerSnapshot } from "@trust-index/types";
import { divRoundHalfUp } from "@trust-index/types";
import { commonFunderShare, reviewerCohortSameDayShare } from "../src/signals.js";
import { ONE, parseFx } from "../src/fixedmath.js";

const WINDOW_24H = parseFx("24") * 3600n; // INNER-scaled seconds, matching constants.ts's convention

function reviewer(overrides: Partial<ReviewerSnapshot>): ReviewerSnapshot {
  return {
    address: "0x0000000000000000000000000000000000000a",
    first_seen_block: 1,
    first_seen_ts: "2026-01-01T00:00:00Z",
    total_reviews: 1,
    distinct_agents_reviewed: 1,
    max_reviews_single_day: 1,
    funder_address: null,
    portfolio_top_funder_share: "0.0000",
    has_commerce_with_agent: false,
    ...overrides,
  };
}

describe("reviewerCohortSameDayShare", () => {
  it("empty set is 0", () => {
    expect(reviewerCohortSameDayShare([], WINDOW_24H)).toBe(0n);
  });

  it("a lone reviewer has no cohort-mate", () => {
    expect(reviewerCohortSameDayShare([reviewer({})], WINDOW_24H)).toBe(0n);
  });

  it("two reviewers within the window: full share", () => {
    const a = reviewer({ address: "0x0000000000000000000000000000000000000a", first_seen_ts: "2026-01-01T00:00:00Z" });
    const b = reviewer({ address: "0x0000000000000000000000000000000000000b", first_seen_ts: "2026-01-01T12:00:00Z" });
    expect(reviewerCohortSameDayShare([a, b], WINDOW_24H)).toBe(ONE);
  });

  it("two reviewers outside the window: zero share", () => {
    const a = reviewer({ address: "0x0000000000000000000000000000000000000a", first_seen_ts: "2026-01-01T00:00:00Z" });
    const b = reviewer({ address: "0x0000000000000000000000000000000000000b", first_seen_ts: "2026-02-01T00:00:00Z" });
    expect(reviewerCohortSameDayShare([a, b], WINDOW_24H)).toBe(0n);
  });

  it("mixed: only the pair within the window is flagged", () => {
    const a = reviewer({ address: "0x0000000000000000000000000000000000000a", first_seen_ts: "2026-01-01T00:00:00Z" });
    const b = reviewer({ address: "0x0000000000000000000000000000000000000b", first_seen_ts: "2026-01-01T01:00:00Z" });
    const c = reviewer({ address: "0x0000000000000000000000000000000000000c", first_seen_ts: "2027-01-01T00:00:00Z" });
    // a and b flagged, c is not: 2/3.
    expect(reviewerCohortSameDayShare([a, b, c], WINDOW_24H)).toBe(divRoundHalfUp(2n * ONE, 3n));
  });
});

describe("commonFunderShare", () => {
  it("empty set is 0", () => {
    expect(commonFunderShare([])).toBe(0n);
  });

  it("a reviewer with a null funder never counts, even alone", () => {
    expect(commonFunderShare([reviewer({ funder_address: null })])).toBe(0n);
  });

  it("two reviewers sharing a funder: full share", () => {
    const a = reviewer({ address: "0x0000000000000000000000000000000000000a", funder_address: "0x0000000000000000000000000000000000000f" });
    const b = reviewer({ address: "0x0000000000000000000000000000000000000b", funder_address: "0x0000000000000000000000000000000000000f" });
    expect(commonFunderShare([a, b])).toBe(ONE);
  });

  it("two reviewers with distinct funders: zero share", () => {
    const a = reviewer({ address: "0x0000000000000000000000000000000000000a", funder_address: "0x0000000000000000000000000000000000000e" });
    const b = reviewer({ address: "0x0000000000000000000000000000000000000b", funder_address: "0x0000000000000000000000000000000000000f" });
    expect(commonFunderShare([a, b])).toBe(0n);
  });

  it("a null-funder reviewer counts in the denominator but not the numerator", () => {
    const a = reviewer({ address: "0x0000000000000000000000000000000000000a", funder_address: "0x0000000000000000000000000000000000000f" });
    const b = reviewer({ address: "0x0000000000000000000000000000000000000b", funder_address: "0x0000000000000000000000000000000000000f" });
    const c = reviewer({ address: "0x0000000000000000000000000000000000000c", funder_address: null });
    // a and b flagged (2), denominator 3.
    const share = commonFunderShare([a, b, c]);
    expect(share).toBeGreaterThan(0n);
    expect(share).toBeLessThan(ONE);
  });
});
