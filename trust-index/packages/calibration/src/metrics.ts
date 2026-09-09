/**
 * Calibration metrics (SPEC 12.3). All arithmetic is exact integer or
 * fixed-point; no floating point enters a published number.
 */
import { ONE, div, divInt, fromInt, mul, ratio } from "./fixed.js";

/** One evaluation point: a predicted probability in [0,1] and the observed binary outcome. */
export type Prediction = {
  /** SCALE-scaled probability in [0, ONE]. */
  pFx: bigint;
  observed: 0 | 1;
  /** Optional grouping key, used for the per-tier breakdown (SPEC 12.3). */
  tier?: string;
};

/**
 * Brier score: the mean squared error of the probability forecast. Lower is
 * better. 0 is perfect, 0.25 is the always-0.5 forecast, 1 is confidently
 * wrong on every point.
 */
export function brier(preds: readonly Prediction[]): bigint {
  if (preds.length === 0) throw new RangeError("brier: no predictions");
  let sum = 0n;
  for (const p of preds) {
    const diff = p.pFx - (p.observed === 1 ? ONE : 0n);
    sum += mul(diff, diff);
  }
  return divInt(sum, BigInt(preds.length));
}

/**
 * Brier skill score against a reference forecast: 1 - brier/brierRef. Positive
 * means the model beats the reference, 0 means it ties, negative means it is
 * worse. This is how the SPEC 12.5 baseline comparison is reported, because a
 * raw Brier difference is not interpretable on its own.
 */
export function skillScore(modelBrier: bigint, referenceBrier: bigint): bigint {
  if (referenceBrier === 0n) throw new RangeError("skillScore: reference Brier is zero");
  return ONE - div(modelBrier, referenceBrier);
}

/** The base rate: the fraction of points whose observed outcome is 1. */
export function baseRate(preds: readonly Prediction[]): bigint {
  if (preds.length === 0) throw new RangeError("baseRate: no predictions");
  let positives = 0n;
  for (const p of preds) if (p.observed === 1) positives += 1n;
  return ratio(positives, BigInt(preds.length));
}

export type ReliabilityBin = {
  /** Half-open [lo, hi) on the probability axis, except the last bin which includes 1. */
  loFx: bigint;
  hiFx: bigint;
  count: number;
  /** Mean predicted probability in the bin; null when the bin is empty. */
  meanPredictedFx: bigint | null;
  /** Observed frequency of outcome 1 in the bin; null when the bin is empty. */
  observedFrequencyFx: bigint | null;
};

/**
 * Reliability curve (SPEC 12.3: "do agents scored 0.8 succeed ~80% of the
 * time?"). Equal-width bins over [0,1]; a well-calibrated forecast has
 * observedFrequency tracking meanPredicted down the diagonal.
 */
export function reliabilityCurve(preds: readonly Prediction[], bins: number): ReliabilityBin[] {
  if (bins < 1) throw new RangeError("reliabilityCurve: bins must be >= 1");
  const width = ratio(1n, BigInt(bins));
  const buckets: Array<{ sumP: bigint; positives: bigint; count: number }> = Array.from(
    { length: bins },
    () => ({ sumP: 0n, positives: 0n, count: 0 }),
  );

  for (const p of preds) {
    // Integer bin index; the final bin is closed so p = 1 lands inside it.
    let idx = Number((p.pFx * BigInt(bins)) / ONE);
    if (idx >= bins) idx = bins - 1;
    if (idx < 0) idx = 0;
    const b = buckets[idx]!;
    b.sumP += p.pFx;
    b.count += 1;
    if (p.observed === 1) b.positives += 1n;
  }

  return buckets.map((b, i) => ({
    loFx: width * BigInt(i),
    hiFx: i === bins - 1 ? ONE : width * BigInt(i + 1),
    count: b.count,
    meanPredictedFx: b.count === 0 ? null : divInt(b.sumP, BigInt(b.count)),
    observedFrequencyFx: b.count === 0 ? null : ratio(b.positives, BigInt(b.count)),
  }));
}

/**
 * Expected calibration error: the count-weighted mean gap between predicted
 * and observed frequency across the reliability bins. 0 means the curve sits
 * exactly on the diagonal.
 */
export function expectedCalibrationError(curve: readonly ReliabilityBin[], total: number): bigint {
  if (total === 0) throw new RangeError("expectedCalibrationError: no predictions");
  let weighted = 0n;
  for (const b of curve) {
    if (b.count === 0 || b.meanPredictedFx === null || b.observedFrequencyFx === null) continue;
    const gap = b.meanPredictedFx - b.observedFrequencyFx;
    const abs = gap < 0n ? -gap : gap;
    weighted += abs * BigInt(b.count);
  }
  return divInt(weighted, BigInt(total));
}

/**
 * Area under the ROC curve, computed exactly from ranks with proper tie
 * handling (the Mann-Whitney U identity). 1 is perfect separation, 0.5 is
 * chance, 0 is perfectly inverted.
 *
 * Ranks are doubled internally so a tied group's average rank stays an integer,
 * keeping the whole computation exact.
 */
export function auc(preds: readonly Prediction[]): bigint | null {
  const positives = preds.filter((p) => p.observed === 1).length;
  const negatives = preds.length - positives;
  // Undefined without both classes present; the caller reports it as such
  // rather than printing a misleading 0.5.
  if (positives === 0 || negatives === 0) return null;

  const sorted = [...preds].sort((a, b) => (a.pFx < b.pFx ? -1 : a.pFx > b.pFx ? 1 : 0));

  // Doubled ranks: position i (1-based) has doubled rank 2i; a tie group spanning
  // positions [s+1, e] shares the doubled average rank (s + 1 + e).
  let doubledRankSumPositives = 0n;
  let i = 0;
  while (i < sorted.length) {
    let j = i;
    while (j + 1 < sorted.length && sorted[j + 1]!.pFx === sorted[i]!.pFx) j += 1;
    const doubledAvgRank = BigInt(i + 1) + BigInt(j + 1);
    for (let k = i; k <= j; k++) {
      if (sorted[k]!.observed === 1) doubledRankSumPositives += doubledAvgRank;
    }
    i = j + 1;
  }

  const nPos = BigInt(positives);
  const nNeg = BigInt(negatives);
  // AUC = (sumRanks(pos) - nPos(nPos+1)/2) / (nPos*nNeg), with ranks doubled:
  //     = (doubledSum - nPos(nPos+1)) / (2*nPos*nNeg)
  const numerator = doubledRankSumPositives - nPos * (nPos + 1n);
  return ratio(numerator, 2n * nPos * nNeg);
}

export type TierBreakdown = {
  tier: string;
  count: number;
  brierFx: bigint;
  baseRateFx: bigint;
  meanPredictedFx: bigint;
};

/**
 * Per-coverage-tier calibration (SPEC 12.3: "are thin scores appropriately
 * uncertain, or overconfident?"). Reported per tier so a tier that is
 * systematically overconfident is visible rather than averaged away.
 */
export function byTier(preds: readonly Prediction[]): TierBreakdown[] {
  const groups = new Map<string, Prediction[]>();
  for (const p of preds) {
    const key = p.tier ?? "unknown";
    const list = groups.get(key);
    if (list === undefined) groups.set(key, [p]);
    else list.push(p);
  }
  return [...groups.keys()]
    .sort()
    .map((tier) => {
      const group = groups.get(tier)!;
      let sumP = 0n;
      for (const p of group) sumP += p.pFx;
      return {
        tier,
        count: group.length,
        brierFx: brier(group),
        baseRateFx: baseRate(group),
        meanPredictedFx: divInt(sumP, BigInt(group.length)),
      };
    });
}

export type MetricSet = {
  n: number;
  brierFx: bigint;
  baseRateFx: bigint;
  /** Brier of the constant base-rate forecast: the floor any real model must beat. */
  baseRateBrierFx: bigint;
  skillVsBaseRateFx: bigint;
  reliability: ReliabilityBin[];
  eceFx: bigint;
  /** null when only one class is present in the evaluation set. */
  aucFx: bigint | null;
  tiers: TierBreakdown[];
};

export function evaluate(preds: readonly Prediction[], bins = 10): MetricSet {
  const b = brier(preds);
  const rate = baseRate(preds);
  const constantForecast: Prediction[] = preds.map((p) => ({ pFx: rate, observed: p.observed }));
  const baseBrier = brier(constantForecast);
  const curve = reliabilityCurve(preds, bins);
  return {
    n: preds.length,
    brierFx: b,
    baseRateFx: rate,
    baseRateBrierFx: baseBrier,
    skillVsBaseRateFx: baseBrier === 0n ? 0n : skillScore(b, baseBrier),
    reliability: curve,
    eceFx: expectedCalibrationError(curve, preds.length),
    aucFx: auc(preds),
    tiers: byTier(preds),
  };
}

/** Helper for callers holding plain probabilities in [0,1] as decimal strings. */
export function predictionFromParts(pFx: bigint, observed: 0 | 1, tier?: string): Prediction {
  if (pFx < 0n || pFx > ONE) throw new RangeError("prediction probability must be in [0,1]");
  return tier === undefined ? { pFx, observed } : { pFx, observed, tier };
}

export { ONE as METRIC_ONE, fromInt as metricFromInt };
