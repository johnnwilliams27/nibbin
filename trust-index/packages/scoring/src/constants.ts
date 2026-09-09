/**
 * Parse snapshot methodology constants into INNER-scaled fixed-point values.
 * The engine uses ONLY these (SPEC 11): no scoring literal appears anywhere
 * else in the package. Provenance prose is not read by the engine; it is
 * excluded from inputs_hash while the values themselves are included
 * (see hash.ts).
 */
import type { MethodologyConstants } from "@trust-index/types";
import { parseFx } from "./fixedmath.js";

export type ConstantsFx = {
  methodologyVersion: string;
  shrinkageK: bigint;
  decayHalfLifeDays: bigint;
  ageRampDays: bigint;
  ageFloor: bigint;
  /** Cohort window in seconds, INNER-scaled. Exact: hours * 3600. */
  cohortWindowSeconds: bigint;
  cohortPenalty: bigint;
  commonFunderMultiplier: bigint;
  velocityThresholdPerDay: bigint;
  velocityMultiplier: bigint;
  repeatBonusMultiplier: bigint;
  repeatBonusCap: bigint;
  commerceMultiplier: bigint;
  portfolioPenalty: bigint;
  weightFloor: bigint;
  suppressionNeffFloor: bigint;
  thinNeffMax: bigint;
  moderateNeffMax: bigint;
  strongMinSpanDays: bigint;
  strongMinCounterparties: bigint;
  liveWindowDays: bigint;
  dormantWindowDays: bigint;
};

export function parseConstants(c: MethodologyConstants): ConstantsFx {
  return {
    methodologyVersion: c.methodology_version,
    shrinkageK: parseFx(c.shrinkage_k.value),
    decayHalfLifeDays: parseFx(c.decay_half_life_days.value),
    ageRampDays: parseFx(c.weight.age_ramp_days.value),
    ageFloor: parseFx(c.weight.age_floor.value),
    cohortWindowSeconds: parseFx(c.weight.cohort_window_hours.value) * 3600n,
    cohortPenalty: parseFx(c.weight.cohort_penalty.value),
    commonFunderMultiplier: parseFx(c.weight.common_funder_multiplier.value),
    velocityThresholdPerDay: parseFx(c.weight.velocity_threshold_per_day.value),
    velocityMultiplier: parseFx(c.weight.velocity_multiplier.value),
    repeatBonusMultiplier: parseFx(c.weight.repeat_bonus_multiplier.value),
    repeatBonusCap: parseFx(c.weight.repeat_bonus_cap.value),
    commerceMultiplier: parseFx(c.weight.commerce_multiplier.value),
    portfolioPenalty: parseFx(c.weight.portfolio_penalty.value),
    weightFloor: parseFx(c.weight.weight_floor.value),
    suppressionNeffFloor: parseFx(c.suppression_neff_floor.value),
    thinNeffMax: parseFx(c.tiers.thin_neff_max.value),
    moderateNeffMax: parseFx(c.tiers.moderate_neff_max.value),
    strongMinSpanDays: parseFx(c.tiers.strong_min_span_days.value),
    strongMinCounterparties: parseFx(c.tiers.strong_min_counterparties.value),
    liveWindowDays: parseFx(c.lifecycle.live_window_days.value),
    dormantWindowDays: parseFx(c.lifecycle.dormant_window_days.value),
  };
}
