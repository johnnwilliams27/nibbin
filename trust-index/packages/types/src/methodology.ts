/**
 * Methodology constants (SPEC §11, §12). Every constant is either `tuned`
 * (traceable to a calibration optimization run) or `provisional` (chosen by
 * sensitivity analysis, replaced when the label set supports tuning).
 * All v0.1.0 constants are provisional: no calibration data exists yet.
 *
 * Values are DecimalStrings so the engine parses them into FixedNum at a
 * declared precision; no float ever enters the scoring path.
 */
import type { DecimalString } from "./fixed.js";

export type ConstantProvenance = {
  provisional: boolean;
  /** Identifier of the calibration run that produced the value; null while provisional. */
  tuning_run: string | null;
  /** One-sentence rationale or the sensitivity-analysis reference. */
  basis: string;
};

export type TunableConstant = {
  value: DecimalString;
  provenance: ConstantProvenance;
};

export type MethodologyConstants = {
  methodology_version: string;

  /** Shrinkage constant k in posterior = (Σ w·v + k·prior) / (Σ w + k). */
  shrinkage_k: TunableConstant;

  /** Exponential decay half-life for within-epoch feedback, in days. */
  decay_half_life_days: TunableConstant;

  /** Reviewer weight multipliers (SPEC §11.2). Each in (0,1] except bonuses noted. */
  weight: {
    /** Address age ramps from age_floor at 0 days to 1.0 at age_ramp_days. */
    age_ramp_days: TunableConstant;
    age_floor: TunableConstant;
    /** Two reviewers share a creation cohort when first_seen within this window (hours). */
    cohort_window_hours: TunableConstant;
    /** Multiplier applied per unit cohort share: w *= 1 - cohort_share * cohort_penalty. */
    cohort_penalty: TunableConstant;
    /** Multiplier when the reviewer shares a first funder with >=1 other reviewer of this agent. */
    common_funder_multiplier: TunableConstant;
    /** Reviews/day beyond which velocity penalty applies. */
    velocity_threshold_per_day: TunableConstant;
    /** Multiplier for reviewers past the velocity threshold. */
    velocity_multiplier: TunableConstant;
    /** Up-weight multiplier per additional review of the same agent, capped. */
    repeat_bonus_multiplier: TunableConstant;
    repeat_bonus_cap: TunableConstant;
    /** Up-weight multiplier when the reviewer has on-chain commerce with the agent. Capped at weight 1.0. */
    commerce_multiplier: TunableConstant;
    /** Multiplier applied per unit of the reviewer's portfolio share concentrated on one funder's agents. */
    portfolio_penalty: TunableConstant;
    /** Absolute weight floor; weights never reach 0 (SPEC §11.2). */
    weight_floor: TunableConstant;
  };

  /** Suppression floor: score is null when n_eff < this (SPEC §11.0). */
  suppression_neff_floor: TunableConstant;

  /** Coverage tier thresholds (SPEC §11.5). */
  tiers: {
    thin_neff_max: TunableConstant;
    moderate_neff_max: TunableConstant;
    strong_min_span_days: TunableConstant;
    strong_min_counterparties: TunableConstant;
  };

  /** Lifecycle windows in days (SPEC §11.7). */
  lifecycle: {
    live_window_days: TunableConstant;
    dormant_window_days: TunableConstant;
  };

  /** Interval method: normal approximation on the weighted Beta posterior. */
  interval_method: "normal_approx";

  /**
   * Confidence transform: confidence = 1 - min(1, interval_width / max_width),
   * where max_width is the interval width of the bare prior (n_eff = 0).
   * Monotone in interval width; derived from the posterior, never blended
   * (SPEC §11.1).
   */
  confidence_transform: "one_minus_relative_width";
};

function provisional(value: DecimalString, basis: string): TunableConstant {
  return { value, provenance: { provisional: true, tuning_run: null, basis } };
}

/** v0.1.0 defaults. ALL PROVISIONAL. Replace via calibration (SPEC §12), never by taste. */
export const DEFAULT_CONSTANTS: MethodologyConstants = {
  methodology_version: "0.1.0",
  shrinkage_k: provisional("5.00", "sensitivity sweep 1-20 pending; midpoint of stable region assumed"),
  decay_half_life_days: provisional("120", "sensitivity sweep 30-365 pending"),
  weight: {
    age_ramp_days: provisional("365", "SPEC 11.2 stated ramp"),
    age_floor: provisional("0.20", "SPEC 11.2 stated floor"),
    cohort_window_hours: provisional("24", "arXiv 2606.26028 same-day clustering finding"),
    cohort_penalty: provisional("0.90", "near-full dilution at full cohort share; sweep pending"),
    common_funder_multiplier: provisional("0.25", "strong down-weight per SPEC 11.2; sweep pending"),
    velocity_threshold_per_day: provisional("50", "matches published third-party threshold for comparability"),
    velocity_multiplier: provisional("0.30", "sweep pending"),
    repeat_bonus_multiplier: provisional("1.15", "sweep pending"),
    repeat_bonus_cap: provisional("1.50", "cap keeps repeat signal bounded"),
    commerce_multiplier: provisional("1.60", "strongest up-weight per SPEC 11.2; capped at 1.0 total"),
    portfolio_penalty: provisional("0.70", "sweep pending"),
    weight_floor: provisional("0.01", "SPEC 11.2 stated floor"),
  },
  suppression_neff_floor: provisional("0.50", "SPEC 11.0 stated floor"),
  tiers: {
    thin_neff_max: provisional("5", "SPEC 11.5"),
    moderate_neff_max: provisional("25", "SPEC 11.5"),
    strong_min_span_days: provisional("90", "SPEC 11.5"),
    strong_min_counterparties: provisional("10", "SPEC 11.5"),
  },
  lifecycle: {
    live_window_days: provisional("90", "SPEC 11.7"),
    dormant_window_days: provisional("180", "SPEC 11.7"),
  },
  interval_method: "normal_approx",
  confidence_transform: "one_minus_relative_width",
};
