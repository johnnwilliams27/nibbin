/**
 * Continuous reviewer weighting (SPEC 11.2). Each signal yields a
 * multiplier; the weight is their product clamped to [weight_floor, 1.0].
 * Signals describe evidence quality, never intent.
 *
 * Interpretations adopted (recorded in docs/NOTES-track-b.md):
 * - Cohort share denominator is the total number of this agent's
 *   current-epoch reviewers including the reviewer itself; the numerator is
 *   the count of OTHER reviewers whose first_seen falls within
 *   cohort_window_hours (inclusive) of this reviewer's first_seen.
 * - The velocity comparison is strict (max_reviews_single_day > threshold).
 * - The repeat bonus counts current-epoch non-revoked reviews of this agent
 *   by the reviewer; the multiplier is repeat_bonus_multiplier^(count - 1),
 *   capped at repeat_bonus_cap.
 */
import type { ReviewerSnapshot } from "@trust-index/types";
import type { ConstantsFx } from "./constants.js";
import { ONE, clampFx, divFx, intFx, minFx, mulFx, parseFx } from "./fixedmath.js";
import { parseIsoUtcSeconds } from "./time.js";
import { divRoundHalfUp } from "@trust-index/types";

export type WeightComponentsFx = {
  age: bigint;
  cohort: bigint;
  funder: bigint;
  velocity: bigint;
  repeat: bigint;
  commerce: bigint;
  portfolio: bigint;
};

export type ReviewerWeightFx = {
  address: string;
  /** Final weight, INNER-scaled, clamped to [weight_floor, 1]. */
  weightFx: bigint;
  components: WeightComponentsFx;
};

/**
 * Compute weights for every current-epoch reviewer of this agent.
 * `reviewers` must contain exactly the current-epoch reviewer set;
 * `reviewCountByAddress` maps address to the reviewer's count of
 * current-epoch non-revoked reviews of this agent. Output is sorted by
 * address (SPEC 22: no iteration-order dependence).
 */
export function computeReviewerWeights(
  reviewers: ReviewerSnapshot[],
  reviewCountByAddress: ReadonlyMap<string, number>,
  asOfSec: number,
  c: ConstantsFx,
): ReviewerWeightFx[] {
  const sorted = [...reviewers].sort((a, b) => (a.address < b.address ? -1 : a.address > b.address ? 1 : 0));
  const firstSeenSec = new Map<string, number>();
  for (const r of sorted) firstSeenSec.set(r.address, parseIsoUtcSeconds(r.first_seen_ts));
  const total = sorted.length;

  return sorted.map((r) => {
    const mySeen = firstSeenSec.get(r.address)!;

    // Age: ramps from age_floor at 0 days to 1.0 at age_ramp_days, linear.
    const ageSeconds = asOfSec >= mySeen ? asOfSec - mySeen : 0;
    const ageDaysFx = divRoundHalfUp(BigInt(ageSeconds) * ONE, 86400n);
    const ageRatio = minFx(ONE, divFx(ageDaysFx, c.ageRampDays));
    const age = c.ageFloor + mulFx(ONE - c.ageFloor, ageRatio);

    // Cohort: share of this agent's reviewers created within the window.
    let othersInWindow = 0;
    for (const other of sorted) {
      if (other.address === r.address) continue;
      const otherSeen = firstSeenSec.get(other.address)!;
      const gap = otherSeen >= mySeen ? otherSeen - mySeen : mySeen - otherSeen;
      if (BigInt(gap) * ONE <= c.cohortWindowSeconds) othersInWindow += 1;
    }
    const cohortShare = total === 0 ? 0n : divRoundHalfUp(BigInt(othersInWindow) * ONE, BigInt(total));
    const cohort = clampFx(ONE - mulFx(cohortShare, c.cohortPenalty), 0n, ONE);

    // Common funder: shares a first funding source with another reviewer.
    let sharesFunder = false;
    if (r.funder_address !== null) {
      for (const other of sorted) {
        if (other.address !== r.address && other.funder_address === r.funder_address) {
          sharesFunder = true;
          break;
        }
      }
    }
    const funder = sharesFunder ? c.commonFunderMultiplier : ONE;

    // Velocity: bulk reviewers carry less signal each.
    const velocity = intFx(r.max_reviews_single_day) > c.velocityThresholdPerDay ? c.velocityMultiplier : ONE;

    // Repeat interaction: returning to the same agent is expensive to fake.
    const count = reviewCountByAddress.get(r.address) ?? 0;
    let repeat = ONE;
    for (let i = 1; i < count; i++) repeat = mulFx(repeat, c.repeatBonusMultiplier);
    repeat = minFx(repeat, c.repeatBonusCap);

    // Commerce corroboration: a review backed by a paid job.
    const commerce = r.has_commerce_with_agent ? c.commerceMultiplier : ONE;

    // Portfolio diversity: clustering on a single funder's agents.
    const portfolio = clampFx(ONE - mulFx(parseShare(r.portfolio_top_funder_share), c.portfolioPenalty), 0n, ONE);

    let w = age;
    w = mulFx(w, cohort);
    w = mulFx(w, funder);
    w = mulFx(w, velocity);
    w = mulFx(w, repeat);
    w = mulFx(w, commerce);
    w = mulFx(w, portfolio);
    w = clampFx(w, c.weightFloor, ONE);

    return {
      address: r.address,
      weightFx: w,
      components: { age, cohort, funder, velocity, repeat, commerce, portfolio },
    };
  });
}

function parseShare(s: string): bigint {
  return clampFx(parseFx(s), 0n, ONE);
}
