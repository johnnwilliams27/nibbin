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
 * Two kinds of stability, reported separately (see rank.ts). Score stability
 * asks how far the published magnitude moves. Rank stability asks whether the
 * ordering survives. They come apart: a constant that lifts every agent by the
 * same amount destroys the first and leaves the second untouched. Collapsing
 * them into one verdict would overstate what an unverified constant costs a
 * reader who only wants to compare two agents.
 *
 * This is deliberately not a substitute for calibration. It shows stability,
 * never correctness: a constant can be perfectly stable and still wrong.
 */
import type { AgentSnapshot, MethodologyConstants } from "@trust-index/types";
import { score } from "@trust-index/scoring";
import { ONE, divInt, format, parse, ratio } from "./fixed.js";
import { rankStability, type RankStability } from "./rank.js";

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
  /** Whether the ordering survives this setting, independently of how far scores moved. */
  rank: RankStability;
};

export type SensitivityResult = {
  path: ConstantPath;
  baselineValue: string;
  points: SweepPoint[];
  /** Largest mean absolute score delta seen anywhere in the sweep. */
  worstMeanAbsDeltaFx: bigint;
  /** Total tier changes at the sweep's most disruptive point. */
  worstTierChanges: number;
  /** Lowest pair-ordering agreement anywhere in the sweep. Null when no point could measure it. */
  worstPairAgreementFx: bigint | null;
  /** Lowest Spearman correlation anywhere in the sweep. Null when no point could measure it. */
  worstSpearmanFx: bigint | null;
  /** Largest single-agent rank displacement anywhere in the sweep. */
  worstMaxRankShift: number;
  /**
   * The smallest baseline score gap at which pair agreement holds at or above
   * `rankStabilityThreshold` across every setting in the sweep. This is the
   * practical answer to "how far apart must two agents be before I can quote
   * their ordering", and it is the number worth putting on the methodology
   * page. Null when no tested margin reaches the threshold, which means the
   * ordering is not safe from this constant at any separation tested.
   */
  safeSeparationFx: bigint | null;
  /**
   * Stable when no sweep point moves the mean score by more than
   * `stabilityThresholdPoints` and no point flips a tier. A stable constant is
   * defensible to ship provisional; an unstable one must be flagged.
   */
  stable: boolean;
  /**
   * Rank-stable when every sweep point keeps pair-ordering agreement at or
   * above `rankStabilityThreshold`. A sweep that could not measure agreement at
   * all is not called stable: an unmeasurable claim is not a supported one.
   *
   * A constant can be rank-stable and not score-stable, which is the useful
   * case: comparisons and threshold gating survive it even though the published
   * magnitude does not.
   */
  rankStable: boolean;
};

type Observed = { score: number | null; scoreFx: bigint | null; tier: string };

function observe(cohort: readonly AgentSnapshot[], constants: MethodologyConstants): Observed[] {
  return cohort.map((s) => {
    const { result } = score({ ...s, constants });
    return {
      score: result.score,
      scoreFx: result.score === null ? null : parse(result.score.toFixed(2)),
      tier: result.coverage_tier,
    };
  });
}

/**
 * Sweep one constant across `values`, comparing every setting against the
 * cohort's own baseline constants.
 *
 * `stabilityThresholdPoints` and `rankStabilityThreshold` are reporting
 * thresholds for this analysis, not methodology constants: they decide only
 * what the report calls stable, and both the underlying measurements and the
 * thresholds are published so a reader can apply a different strictness.
 */
export function sweepConstant(
  cohort: readonly AgentSnapshot[],
  path: ConstantPath,
  values: readonly string[],
  options: { stabilityThresholdPoints?: string; rankStabilityThreshold?: string } = {},
): SensitivityResult {
  if (cohort.length === 0) throw new RangeError("sweepConstant: empty cohort");
  const threshold = parse(options.stabilityThresholdPoints ?? "1");
  const rankThreshold = parse(options.rankStabilityThreshold ?? "0.99");

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
      rank: rankStability(
        baseline.map((o) => o.scoreFx),
        observedAt.map((o) => o.scoreFx),
      ),
    };
  });

  let worstMeanAbsDeltaFx = 0n;
  let worstTierChanges = 0;
  let worstPairAgreementFx: bigint | null = null;
  let worstSpearmanFx: bigint | null = null;
  let worstMaxRankShift = 0;
  for (const p of points) {
    if (p.meanAbsScoreDeltaFx > worstMeanAbsDeltaFx) worstMeanAbsDeltaFx = p.meanAbsScoreDeltaFx;
    if (p.tierChanges > worstTierChanges) worstTierChanges = p.tierChanges;
    if (p.rank.pairAgreementFx !== null && (worstPairAgreementFx === null || p.rank.pairAgreementFx < worstPairAgreementFx)) {
      worstPairAgreementFx = p.rank.pairAgreementFx;
    }
    if (p.rank.spearmanFx !== null && (worstSpearmanFx === null || p.rank.spearmanFx < worstSpearmanFx)) {
      worstSpearmanFx = p.rank.spearmanFx;
    }
    if (p.rank.maxRankShift > worstMaxRankShift) worstMaxRankShift = p.rank.maxRankShift;
  }

  // The narrowest margin at which every setting in the sweep keeps agreement
  // above the threshold. A margin no setting could measure does not qualify:
  // an unmeasured claim is not a supported one.
  let safeSeparationFx: bigint | null = null;
  const margins = points[0]?.rank.separation ?? [];
  for (let t = 0; t < margins.length; t += 1) {
    let measured = false;
    let holds = true;
    for (const p of points) {
      const agreement = p.rank.separation[t]?.agreementFx ?? null;
      if (agreement === null) continue;
      measured = true;
      if (agreement < rankThreshold) holds = false;
    }
    if (measured && holds) {
      safeSeparationFx = margins[t]!.minGapFx;
      break;
    }
  }

  return {
    path,
    baselineValue,
    points,
    worstMeanAbsDeltaFx,
    worstTierChanges,
    worstPairAgreementFx,
    worstSpearmanFx,
    worstMaxRankShift,
    safeSeparationFx,
    stable: worstMeanAbsDeltaFx <= threshold && worstTierChanges === 0,
    rankStable: worstPairAgreementFx !== null && worstPairAgreementFx >= rankThreshold,
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
