/**
 * Observable-condition signals (SPEC 5.5, 24A): every value describes a
 * measurable condition among this agent's current-epoch reviewers, never an
 * accusation ("38 of 40 reviewer wallets were created within a 24-hour
 * window", never "sybil attack detected").
 *
 * reviewerCohortSameDayShare and commonFunderShare are agent-level population
 * statistics: the fraction of this agent's current-epoch reviewers that have
 * at least one cohort-mate / funder-mate among the others. They mirror the
 * pairwise tests weights.ts uses to compute each reviewer's own multiplier,
 * but are recomputed independently here rather than derived from the
 * per-reviewer components, so that weights.ts stays focused on producing a
 * weight and this module stays focused on producing a population signal. See
 * docs/NOTES-track-b.md.
 */
import type { ReviewerSnapshot } from "@trust-index/types";
import { divRoundHalfUp } from "@trust-index/types";
import { ONE } from "./fixedmath.js";
import { parseIsoUtcSeconds } from "./time.js";

/**
 * Share of `reviewers` that have at least one OTHER reviewer in the set with
 * first_seen within `cohortWindowSecondsFx` (INNER-scaled seconds, inclusive)
 * of its own. INNER-scaled result in [0,1]; 0 when `reviewers` is empty.
 */
export function reviewerCohortSameDayShare(
  reviewers: ReviewerSnapshot[],
  cohortWindowSecondsFx: bigint,
): bigint {
  const total = reviewers.length;
  if (total === 0) return 0n;
  const seenSec = reviewers.map((r) => parseIsoUtcSeconds(r.first_seen_ts));
  let flagged = 0;
  for (let i = 0; i < total; i++) {
    let hasCohortMate = false;
    for (let j = 0; j < total; j++) {
      if (i === j) continue;
      const a = seenSec[i]!;
      const b = seenSec[j]!;
      const gap = a >= b ? a - b : b - a;
      if (BigInt(gap) * ONE <= cohortWindowSecondsFx) {
        hasCohortMate = true;
        break;
      }
    }
    if (hasCohortMate) flagged += 1;
  }
  return divRoundHalfUp(BigInt(flagged) * ONE, BigInt(total));
}

/**
 * Share of `reviewers` that share a non-null funder_address with at least one
 * other reviewer in the set. INNER-scaled result in [0,1]; 0 when `reviewers`
 * is empty. Reviewers with a null funder never count toward the numerator but
 * still count toward the denominator (they are still current-epoch reviewers
 * of this agent).
 */
export function commonFunderShare(reviewers: ReviewerSnapshot[]): bigint {
  const total = reviewers.length;
  if (total === 0) return 0n;
  let flagged = 0;
  for (const r of reviewers) {
    if (r.funder_address === null) continue;
    const shared = reviewers.some(
      (other) => other.address !== r.address && other.funder_address === r.funder_address,
    );
    if (shared) flagged += 1;
  }
  return divRoundHalfUp(BigInt(flagged) * ONE, BigInt(total));
}
