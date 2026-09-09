/**
 * Shrinkage estimator with interval and confidence (SPEC 11.0, 11.1, 11.3).
 *
 * posterior = (sum w*v + k * prior) / (n_eff + k), on [0,1]
 *
 * Interval: normal approximation on the weighted Beta posterior.
 *   alpha = k * prior + sum(w * v)
 *   beta  = k * (1 - prior) + sum(w * (1 - v))
 *   m = alpha / (alpha + beta)
 *   variance = m * (1 - m) / (alpha + beta + 1)
 *   half width = 1.96 * sqrt(variance)
 * The square root floors at the 12th decimal place (see fixedmath.ts); all
 * divisions round half up.
 *
 * Confidence = 1 - min(1, width / width_prior_only), where width is the
 * UNCLAMPED interval width (2 * half width) and width_prior_only is the same
 * formula at n_eff = 0. Clamping the display bounds to [0,1] does not feed
 * back into confidence: that would reward extreme point estimates. When the
 * prior-only width is zero the transform is undefined and confidence is 0.
 * Confidence is derived from the posterior only, never blended (SPEC 11.1).
 *
 * Anti-flooding cap (deliberate deviation, recorded in
 * docs/NOTES-track-b.md): within one grouping (a context, or the global
 * pool), each entry contributes with its own decayed weight, but a single
 * reviewer's total contribution is capped at their undecayed weight. When
 * the reviewer's decayed sum S exceeds their weight w, all their
 * contributions scale by w/S.
 */
import { ONE, Z95, clampFx, divFx, minFx, mulFx, sqrtFx } from "./fixedmath.js";
import { divRoundHalfUp } from "@trust-index/types";

/** One usable feedback entry's contribution before capping. */
export type WeightedObservation = {
  /** Reviewer address, for the per-reviewer cap. */
  address: string;
  /** Decayed effective weight: reviewer weight * 2^(-age_days / half_life). */
  effectiveWeightFx: bigint;
  /** Normalized value in [0,1], INNER-scaled. */
  valueFx: bigint;
};

export type CappedSums = {
  /** n_eff: sum of capped effective weights. */
  neffFx: bigint;
  /** Sum of capped w*v. */
  sumWVFx: bigint;
};

/**
 * Apply the per-reviewer cap and reduce to (n_eff, sum w*v). `observations`
 * are processed grouped by address in lexicographic order; `undecayedWeight`
 * maps address to the reviewer's undecayed weight, used as a safety ceiling.
 *
 * Anti-flooding rule (SPEC 11.1/24A: n_eff is the sum of REVIEWER weights,
 * one per reviewer): a reviewer's total contribution is capped so many
 * reviews cannot inflate their influence past a single review's worth. The
 * ceiling is the reviewer's strongest single decayed observation, not their
 * undecayed weight. Capping at the undecayed weight would let a pile of old
 * reviews climb back to the full 1.0 weight and erase the SPEC 11.4 time
 * decay entirely (a reviewer who left 40 reviews two years ago would count
 * like one who reviewed today). Capping at the most-recent decayed weight
 * keeps the one-reviewer-one-vote property while letting the ceiling itself
 * decay with the reviewer's last interaction.
 */
export function capAndSum(
  observations: WeightedObservation[],
  undecayedWeightByAddress: ReadonlyMap<string, bigint>,
): CappedSums {
  const byAddress = new Map<string, WeightedObservation[]>();
  for (const o of observations) {
    const list = byAddress.get(o.address);
    if (list === undefined) byAddress.set(o.address, [o]);
    else list.push(o);
  }
  const addresses = [...byAddress.keys()].sort();
  let neffFx = 0n;
  let sumWVFx = 0n;
  for (const address of addresses) {
    const w = undecayedWeightByAddress.get(address);
    if (w === undefined) throw new Error(`no weight computed for reviewer ${address}`);
    let s = 0n;
    let v = 0n;
    let maxEffectiveFx = 0n;
    for (const o of byAddress.get(address)!) {
      s += o.effectiveWeightFx;
      v += mulFx(o.effectiveWeightFx, o.valueFx);
      if (o.effectiveWeightFx > maxEffectiveFx) maxEffectiveFx = o.effectiveWeightFx;
    }
    // Ceiling: the reviewer's strongest single decayed review, never above
    // their undecayed weight. Each decayed weight is already <= w, so the min
    // is a defensive guard rather than an active clamp.
    const cap = maxEffectiveFx < w ? maxEffectiveFx : w;
    if (s > cap) {
      v = divRoundHalfUp(v * cap, s);
      s = cap;
    }
    neffFx += s;
    sumWVFx += v;
  }
  return { neffFx, sumWVFx };
}

export type PosteriorFx = {
  /** Point estimate on [0,1]. */
  meanFx: bigint;
  /** Lower 95% bound, clamped to [0,1]. */
  lowFx: bigint;
  /** Upper 95% bound, clamped to [0,1]. */
  highFx: bigint;
  /** Unclamped interval width (2 * half width). */
  widthFx: bigint;
  /** 1 - min(1, width / width_prior_only). */
  confidenceFx: bigint;
  alphaFx: bigint;
  betaFx: bigint;
};

function intervalWidthFx(alphaFx: bigint, betaFx: bigint): { meanFx: bigint; halfFx: bigint } {
  const ab = alphaFx + betaFx;
  // No prior mass and no evidence (k = 0 with an empty epoch): the Beta
  // posterior is undefined. Report maximum ignorance, mean 0.5 and the widest
  // half interval, rather than dividing by zero. This only reaches a score
  // that is already suppressed for n_eff below the floor.
  if (ab === 0n) {
    const halfMax = mulFx(Z95, sqrtFx(divRoundHalfUp(ONE, 4n)));
    return { meanFx: ONE / 2n, halfFx: halfMax };
  }
  const meanFx = divFx(alphaFx, ab);
  const varianceFx = divRoundHalfUp(meanFx * (ONE - meanFx), ab + ONE);
  const halfFx = mulFx(Z95, sqrtFx(varianceFx));
  return { meanFx, halfFx };
}

/**
 * Reference width for the confidence transform: the widest a prior-only
 * interval can be, which is the interval at the maximum-uncertainty prior of
 * 0.5 for this k. The reference is deliberately independent of the agent's
 * actual prior. Normalizing by the actual prior's width degenerates as the
 * prior approaches 0 or 1 (its width shrinks to 0), which forced confidence to
 * 0 for a well-evidenced agent and put a discontinuity at exactly 0 or 1. A
 * fixed reference makes confidence a monotone function of the posterior
 * interval width alone (SPEC 11.1), so meetsThreshold(minConfidence) means the
 * same thing regardless of where the prior sits.
 */
export function referenceWidthFx(kFx: bigint): bigint {
  const half = ONE / 2n;
  return 2n * intervalWidthFx(mulFx(kFx, half), mulFx(kFx, ONE - half)).halfFx;
}

export function posterior(sums: CappedSums, priorFx: bigint, kFx: bigint): PosteriorFx {
  const alphaFx = mulFx(kFx, priorFx) + sums.sumWVFx;
  const betaFx = mulFx(kFx, ONE - priorFx) + (sums.neffFx - sums.sumWVFx);
  const { meanFx, halfFx } = intervalWidthFx(alphaFx, betaFx);
  const widthFx = 2n * halfFx;

  const width0Fx = referenceWidthFx(kFx);
  const confidenceFx = width0Fx === 0n ? 0n : ONE - minFx(ONE, divFx(widthFx, width0Fx));

  return {
    meanFx,
    lowFx: clampFx(meanFx - halfFx, 0n, ONE),
    highFx: clampFx(meanFx + halfFx, 0n, ONE),
    widthFx,
    confidenceFx,
    alphaFx,
    betaFx,
  };
}
