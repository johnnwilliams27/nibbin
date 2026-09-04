/**
 * Parse RatingConstants into INNER-scaled bigints once, at the top of a scoring
 * run. Same discipline as constants.ts on the chain path: every DecimalString
 * is parsed exactly or throws, and nothing downstream ever sees a string.
 */
import type { Provenance, RatingConstants } from "@trust-index/types";
import { ONE, parseFx } from "../fixedmath.js";

export type RatingConstantsFx = {
  version: string;
  shrinkageK: bigint;
  decayHalfLifeDays: bigint;
  ageRampDays: bigint;
  ageFloor: bigint;
  groupPenalty: bigint;
  concentrationPenalty: bigint;
  velocityThresholdPerDay: bigint;
  velocityMultiplier: bigint;
  interactionMultiplier: bigint;
  provenanceMultiplier: ReadonlyMap<Provenance, bigint>;
  weightFloor: bigint;
  suppressionNeffFloor: bigint;
  liveWindowDays: bigint;
  dormantWindowDays: bigint;
  thinNeffMax: bigint;
  moderateNeffMax: bigint;
  strongMinSpanDays: bigint;
  strongMinObservers: bigint;
};

function unit(label: string, s: string): bigint {
  const v = parseFx(s);
  if (v < 0n || v > ONE) throw new RangeError(`${label} must be in [0,1], got ${JSON.stringify(s)}`);
  return v;
}

function positive(label: string, s: string): bigint {
  const v = parseFx(s);
  if (v <= 0n) throw new RangeError(`${label} must be positive, got ${JSON.stringify(s)}`);
  return v;
}

export function parseRatingConstants(c: RatingConstants): RatingConstantsFx {
  const provenance = new Map<Provenance, bigint>();
  for (const k of ["measured", "attested", "third_party_review", "self_reported"] as const) {
    const raw = c.provenance_multiplier[k];
    if (raw === undefined) throw new Error(`missing provenance multiplier for ${k}`);
    provenance.set(k, unit(`provenance_multiplier.${k}`, raw));
  }
  return {
    version: c.rating_methodology_version,
    // k = 0 is legal (no shrinkage) but negative is not.
    shrinkageK: (() => {
      const v = parseFx(c.shrinkage_k);
      if (v < 0n) throw new RangeError("shrinkage_k must not be negative");
      return v;
    })(),
    decayHalfLifeDays: positive("decay_half_life_days", c.decay_half_life_days),
    ageRampDays: positive("age_ramp_days", c.age_ramp_days),
    ageFloor: unit("age_floor", c.age_floor),
    groupPenalty: unit("group_penalty", c.group_penalty),
    concentrationPenalty: unit("concentration_penalty", c.concentration_penalty),
    velocityThresholdPerDay: parseFx(c.velocity_threshold_per_day),
    velocityMultiplier: unit("velocity_multiplier", c.velocity_multiplier),
    // Above 1 by design: an up-weight. The product is clamped to 1 afterwards.
    interactionMultiplier: (() => {
      const v = parseFx(c.interaction_multiplier);
      if (v < ONE) throw new RangeError("interaction_multiplier must be at least 1");
      return v;
    })(),
    provenanceMultiplier: provenance,
    weightFloor: unit("weight_floor", c.weight_floor),
    suppressionNeffFloor: parseFx(c.suppression_neff_floor),
    liveWindowDays: positive("live_window_days", c.live_window_days),
    dormantWindowDays: positive("dormant_window_days", c.dormant_window_days),
    thinNeffMax: parseFx(c.thin_neff_max),
    moderateNeffMax: parseFx(c.moderate_neff_max),
    strongMinSpanDays: parseFx(c.strong_min_span_days),
    strongMinObservers: parseFx(c.strong_min_observers),
  };
}
