/**
 * Cohort priors, weighted so one operator cannot define "typical".
 *
 * The estimator shrinks a thin subject toward a cohort prior, and until now
 * that prior has been a number chosen by hand: 0.55, with a declared basis of
 * one. Every score published so far is substantially that invented figure
 * wearing a subject's name. This computes a real one.
 *
 * The census made clear why a naive population mean will not do. Two operators
 * hold 16.1% of the MCP population: 1,314 servers on one gateway and 1,115 on
 * another. Averaging per subject hands them 16.1% of the prior, so "typical MCP
 * server" would substantially mean "typical server of those two". Averaging per
 * host hands them 0.018%, which discards real information about 2,429 genuinely
 * distinct services.
 *
 * The middle is the standard design-effect correction for clustered samples.
 * A subject in a cluster of size g carries weight 1/sqrt(g), so a cluster of
 * 1,314 contributes about 36 rather than 1,314 or 1. That is the weighting you
 * get under moderate intra-cluster correlation, and 1/sqrt(g) is where the two
 * failure modes balance rather than a number chosen to feel right.
 *
 * The exponent is provisional in the SPEC 12 sense, and unusually well placed
 * to stop being so: when a gateway has an outage we will observe its servers
 * fail together, which measures the intra-cluster correlation directly from our
 * own data rather than from an assumption.
 */
import type { DecimalString, RatingPriorSet, SubjectScoreResult } from "@trust-index/types";

export type PriorInput = {
  /** Cluster this subject belongs to. null means unclustered, weight 1. */
  independence_group: string | null;
  /** The subject's published dimension scores, on the 0-100 display scale. */
  dimensions: Array<{ dimension: string; score: number | null; n_eff: number }>;
};

export type ComputedPrior = {
  priors: RatingPriorSet;
  /** Per-dimension subject counts behind each prior, for the audit trail. */
  contributors: Record<string, number>;
  /** Effective sample size after clustering correction, per dimension. */
  effective: Record<string, number>;
};

/** Integer square root, so the clustering correction never touches a float. */
function isqrt(n: bigint): bigint {
  if (n < 2n) return n;
  let x = 1n << BigInt((n.toString(2).length >> 1) + 1);
  for (;;) {
    const y = (x + n / x) >> 1n;
    if (y >= x) return x;
    x = y;
  }
}

const SCALE = 1_000_000n;

/** 1/sqrt(g) at six decimal places, in integer arithmetic. */
export function clusterWeight(groupSize: number): bigint {
  if (groupSize <= 1) return SCALE;
  // sqrt(g) scaled: isqrt(g * SCALE^2) = sqrt(g) * SCALE
  const rootScaled = isqrt(BigInt(groupSize) * SCALE * SCALE);
  return (SCALE * SCALE) / rootScaled;
}

function toDecimal(scaled: bigint): DecimalString {
  const neg = scaled < 0n;
  const v = neg ? -scaled : scaled;
  const whole = v / SCALE;
  const frac = (v % SCALE).toString().padStart(6, "0");
  return `${neg ? "-" : ""}${whole}.${frac}`;
}

/**
 * Compute a cohort prior from scored subjects.
 *
 * Only PUBLISHED dimension scores contribute. A suppressed dimension is not
 * evidence about the population, and folding "we could not tell" into a mean
 * of "how good things are" would be the same category error the gap model
 * exists to prevent.
 *
 * `minContributors` fails closed: below it, no prior is emitted for that
 * dimension and the caller falls back to the global one. Publishing a
 * per-dimension prior computed from four subjects would be a precise-looking
 * number with nothing behind it.
 */
export function computeCohortPrior(
  subjects: readonly PriorInput[],
  cohort: string,
  options: { minContributors?: number; fallbackGlobal?: DecimalString } = {},
): ComputedPrior {
  const minContributors = options.minContributors ?? 30;

  const groupSizes = new Map<string, number>();
  for (const s of subjects) {
    if (s.independence_group === null) continue;
    groupSizes.set(s.independence_group, (groupSizes.get(s.independence_group) ?? 0) + 1);
  }

  type Acc = { weightedSum: bigint; weight: bigint; count: number };
  const perDimension = new Map<string, Acc>();
  let globalSum = 0n;
  let globalWeight = 0n;
  let globalCount = 0;

  for (const s of subjects) {
    const g = s.independence_group === null ? 1 : (groupSizes.get(s.independence_group) ?? 1);
    const w = clusterWeight(g);
    for (const d of s.dimensions) {
      if (d.score === null) continue;
      // Display scale is 0-100; the prior lives on [0,1].
      const valueScaled = BigInt(Math.round(d.score * 10000));
      const acc = perDimension.get(d.dimension) ?? { weightedSum: 0n, weight: 0n, count: 0 };
      acc.weightedSum += (w * valueScaled) / SCALE;
      acc.weight += w;
      acc.count += 1;
      perDimension.set(d.dimension, acc);
      globalSum += (w * valueScaled) / SCALE;
      globalWeight += w;
      globalCount += 1;
    }
  }

  const byDimension: Record<string, DecimalString> = {};
  const contributors: Record<string, number> = {};
  const effective: Record<string, number> = {};
  for (const [dimension, acc] of perDimension) {
    contributors[dimension] = acc.count;
    effective[dimension] = Number(acc.weight) / Number(SCALE);
    if (acc.count < minContributors || acc.weight === 0n) continue;
    byDimension[dimension] = toDecimal((acc.weightedSum * SCALE) / acc.weight);
  }

  const global =
    globalCount >= minContributors && globalWeight > 0n
      ? toDecimal((globalSum * SCALE) / globalWeight)
      : (options.fallbackGlobal ?? "0.550000");

  return {
    priors: {
      global,
      by_dimension: byDimension,
      basis: "measured_only",
      // n_basis is the CLUSTER-CORRECTED effective count, not the subject
      // count. Reporting 15,121 when two operators supplied 2,429 correlated
      // members of it would overstate what the prior rests on.
      n_basis: toDecimal(globalWeight),
      cohort,
    },
    contributors,
    effective,
  };
}

/** Convenience: build prior inputs from scored results plus their groups. */
export function priorInputsFrom(
  results: ReadonlyArray<{ result: SubjectScoreResult; independence_group: string | null }>,
): PriorInput[] {
  return results.map(({ result, independence_group }) => ({
    independence_group,
    dimensions: result.dimensions.map((d) => ({ dimension: d.dimension, score: d.score, n_eff: d.n_eff })),
  }));
}
