/**
 * Sensitivity analysis (SPEC 12, "Honest failure mode and fallback").
 *
 * Until a commerce label set exists with enough power to tune against, the
 * spec says constants ship as provisional, "chosen by sensitivity analysis
 * (report score stability across a swept range)". This module is that
 * analysis: sweep one constant across a range, rescore a cohort at each step,
 * and report how far the outputs move.
 *
 * It answers a question that does NOT need labels: is the published number
 * hostage to a constant nobody has justified? A constant whose sweep barely
 * moves scores is safe to ship provisionally. One that reshuffles tiers across
 * a plausible range is a live risk and must be said so on /methodology.
 *
 * This is deliberately not a substitute for calibration. It shows stability,
 * never correctness: a constant can be perfectly stable and still wrong.
 */
import type { AgentSnapshot, MethodologyConstants } from "@trust-index/types";
import { score } from "@trust-index/scoring";
import { ONE, divInt, format, parse, ratio } from "./fixed.js";

/** A dotted path to a tunable constant's `value` field on MethodologyConstants. */
export type ConstantPath =
  | "shrinkage_k"
  | "decay_half_life_days"
  | "suppression_neff_floor"
  | `weight.${keyof MethodologyConstants["weight"]}`
  | `tiers.${keyof MethodologyConstants["tiers"]}`
  | `lifecycle.${keyof MethodologyConstants["lifecycle"]}`;

function withConstant(base: MethodologyConstants, path: ConstantPath, value: string): MethodologyConstants {
  const next: MethodologyConstants = JSON.parse(JSON.stringify(base)) as MethodologyConstants;
  const dot = path.indexOf(".");
  if (dot === -1) {
    const key = path as "shrinkage_k" | "decay_half_life_days" | "suppression_neff_floor";
    next[key] = { ...next[key], value };
    return next;
  }
  const group = path.slice(0, dot) as "weight" | "tiers" | "lifecycle";
  const key = path.slice(dot + 1);
  const bucket = next[group] as unknown as Record<string, { value: string }>;
  if (!Object.hasOwn(bucket, key)) throw new Error(`unknown constant path: ${path}`);
  bucket[key] = { ...bucket[key]!, value };
  return next;
}

export type SweepPoint = {
  value: string;
  /** Agents whose score is non-null at this setting. */
  scored: number;
  /** Agents suppressed at this setting. */
  suppressed: number;
  /** Mean absolute score change versus the baseline setting, on the 0-100 scale. */
  meanAbsScoreDeltaFx: bigint;
  /** Largest absolute score change versus the baseline, on the 0-100 scale. */
  maxAbsScoreDeltaFx: bigint;
  /** Agents whose coverage tier differs from the baseline setting. */
  tierChanges: number;
  /** Agents whose suppression state (score null vs not) differs from the baseline. */
  suppressionFlips: number;
};

export type SensitivityResult = {
  path: ConstantPath;
  baselineValue: string;
  points: SweepPoint[];
  /** Largest mean absolute score delta seen anywhere in the sweep. */
  worstMeanAbsDeltaFx: bigint;
  /** Total tier changes at the sweep's most disruptive point. */
  worstTierChanges: number;
  /**
   * Stable when no sweep point moves the mean score by more than
   * `stabilityThresholdPoints` and no point flips a tier. A stable constant is
   * defensible to ship provisional; an unstable one must be flagged.
   */
  stable: boolean;
};

type Observed = { score: number | null; tier: string };

function observe(cohort: readonly AgentSnapshot[], constants: MethodologyConstants): Observed[] {
  return cohort.map((s) => {
    const { result } = score({ ...s, constants });
    return { score: result.score, tier: result.coverage_tier };
  });
}

/**
 * Sweep one constant across `values`, comparing every setting against the
 * cohort's own baseline constants.
 *
 * `stabilityThresholdPoints` is a reporting threshold for this analysis, not a
 * methodology constant: it decides only what the report calls stable.
 */
export function sweepConstant(
  cohort: readonly AgentSnapshot[],
  path: ConstantPath,
  values: readonly string[],
  options: { stabilityThresholdPoints?: string } = {},
): SensitivityResult {
  if (cohort.length === 0) throw new RangeError("sweepConstant: empty cohort");
  const threshold = parse(options.stabilityThresholdPoints ?? "1");

  const base = cohort[0]!.constants;
  const dot = path.indexOf(".");
  const baselineValue =
    dot === -1
      ? (base[path as "shrinkage_k"] as { value: string }).value
      : (
          (base[path.slice(0, dot) as "weight"] as unknown as Record<string, { value: string }>)[
            path.slice(dot + 1)
          ] as { value: string }
        ).value;

  const baseline = observe(cohort, base);

  const points: SweepPoint[] = values.map((value) => {
    const observedAt = observe(cohort, withConstant(base, path, value));
    let sumAbs = 0n;
    let maxAbs = 0n;
    let compared = 0;
    let tierChanges = 0;
    let suppressionFlips = 0;
    let scored = 0;
    let suppressed = 0;

    observedAt.forEach((o, i) => {
      const b = baseline[i]!;
      if (o.score === null) suppressed += 1;
      else scored += 1;
      if (o.tier !== b.tier) tierChanges += 1;
      if ((o.score === null) !== (b.score === null)) suppressionFlips += 1;
      if (o.score !== null && b.score !== null) {
        const delta = parse(o.score.toFixed(2)) - parse(b.score.toFixed(2));
        const abs = delta < 0n ? -delta : delta;
        sumAbs += abs;
        if (abs > maxAbs) maxAbs = abs;
        compared += 1;
      }
    });

    return {
      value,
      scored,
      suppressed,
      meanAbsScoreDeltaFx: compared === 0 ? 0n : divInt(sumAbs, BigInt(compared)),
      maxAbsScoreDeltaFx: maxAbs,
      tierChanges,
      suppressionFlips,
    };
  });

  let worstMeanAbsDeltaFx = 0n;
  let worstTierChanges = 0;
  for (const p of points) {
    if (p.meanAbsScoreDeltaFx > worstMeanAbsDeltaFx) worstMeanAbsDeltaFx = p.meanAbsScoreDeltaFx;
    if (p.tierChanges > worstTierChanges) worstTierChanges = p.tierChanges;
  }

  return {
    path,
    baselineValue,
    points,
    worstMeanAbsDeltaFx,
    worstTierChanges,
    stable: worstMeanAbsDeltaFx <= threshold && worstTierChanges === 0,
  };
}

/** The default sweep grid: plausible ranges around each v0.1.0 provisional constant. */
export const DEFAULT_SWEEPS: ReadonlyArray<{ path: ConstantPath; values: readonly string[] }> = [
  { path: "shrinkage_k", values: ["1", "2.50", "5.00", "10", "20"] },
  { path: "decay_half_life_days", values: ["30", "60", "120", "240", "365"] },
  { path: "weight.age_ramp_days", values: ["90", "180", "365", "540"] },
  { path: "weight.age_floor", values: ["0.05", "0.10", "0.20", "0.40"] },
  { path: "weight.cohort_penalty", values: ["0.50", "0.70", "0.90", "1.00"] },
  { path: "weight.common_funder_multiplier", values: ["0.10", "0.25", "0.50", "0.75"] },
  { path: "weight.portfolio_penalty", values: ["0.30", "0.50", "0.70", "0.90"] },
  { path: "suppression_neff_floor", values: ["0.25", "0.50", "1.00"] },
];

export function runDefaultSensitivity(cohort: readonly AgentSnapshot[]): SensitivityResult[] {
  return DEFAULT_SWEEPS.map((s) => sweepConstant(cohort, s.path, s.values));
}

/** Render a fixed-point score delta for reports. */
export function formatDelta(v: bigint): string {
  return format(v, 2);
}

export { ONE as SENSITIVITY_ONE, ratio as sensitivityRatio };
