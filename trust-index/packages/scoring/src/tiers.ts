/**
 * Coverage tiers (SPEC 11.5): reported, not gating. A statement about how
 * much evidence exists, not about the agent's quality.
 */
import type { CoverageTier } from "@trust-index/types";
import { intFx } from "./fixedmath.js";

export type TierInputs = {
  /** INNER-scaled effective sample size. */
  neffFx: bigint;
  /** Whole days between first and last usable feedback in the current epoch. */
  spanDays: number;
  /** Distinct reviewer addresses behind usable current-epoch feedback. */
  distinctCounterparties: number;
  /** True when the score is suppressed (n_eff below floor, placeholder, or no usable feedback). */
  suppressed: boolean;
};

export type TierConstants = {
  thinNeffMax: bigint;
  moderateNeffMax: bigint;
  strongMinSpanDays: bigint;
  strongMinCounterparties: bigint;
};

export function coverageTier(i: TierInputs, c: TierConstants): CoverageTier {
  if (i.suppressed) return "none";
  if (i.neffFx < c.thinNeffMax) return "thin";
  if (i.neffFx < c.moderateNeffMax) return "moderate";
  if (intFx(i.spanDays) >= c.strongMinSpanDays && intFx(i.distinctCounterparties) >= c.strongMinCounterparties) {
    return "strong";
  }
  return "moderate";
}
