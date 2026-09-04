/**
 * Is a gap between two linkage arms real, or is it sampling noise?
 *
 * A fixed absolute threshold cannot answer this, because the same gap means
 * different things at different sample sizes: an AUC difference of 0.05
 * between two arms of 200 agents is well inside noise, while the same
 * difference across 5,000 agents is not. An earlier version of this comparison
 * used a fixed 0.05 cutoff and flagged a clean, uncorrupted cohort as
 * divergent purely because the two strata were random halves of the same data.
 *
 * So divergence is judged against the gap's own standard error. The
 * two-standard-error cutoff is the conventional normal-approximation reading
 * of "unlikely to be chance", not a tuned constant: a reader who prefers a
 * different strictness can recompute from the published gap and standard
 * error, both of which appear in the report.
 */
import { ONE, div, mul, ratio, sqrt } from "./fixed.js";

/** Conventional normal-approximation multiplier for a two-sided 95% reading. */
export const SIGMA_MULTIPLIER = 2n;

/**
 * Standard error of an AUC estimate (Hanley and McNeil, 1982).
 *
 * SE = sqrt( [A(1-A) + (nPos-1)(Q1 - A^2) + (nNeg-1)(Q2 - A^2)] / (nPos*nNeg) )
 * with Q1 = A/(2-A) and Q2 = 2A^2/(1+A).
 */
export function aucStandardError(aucFx: bigint, nPos: number, nNeg: number): bigint | null {
  if (nPos <= 0 || nNeg <= 0) return null;
  const a = aucFx;
  const a2 = mul(a, a);
  const q1 = div(a, 2n * ONE - a);
  const q2 = div(2n * a2, ONE + a);
  const term1 = mul(a, ONE - a);
  const term2 = BigInt(nPos - 1) * (q1 - a2);
  const term3 = BigInt(nNeg - 1) * (q2 - a2);
  const numerator = term1 + term2 + term3;
  if (numerator <= 0n) return 0n;
  const variance = numerator / BigInt(nPos * nNeg);
  return sqrt(variance);
}

/** Standard error of a proportion: sqrt(p(1-p)/n). */
export function proportionStandardError(pFx: bigint, n: number): bigint | null {
  if (n <= 0) return null;
  const variance = mul(pFx, ONE - pFx) / BigInt(n);
  return sqrt(variance);
}

/** Standard error of the difference of two independent estimates. */
export function differenceStandardError(seA: bigint | null, seB: bigint | null): bigint | null {
  if (seA === null || seB === null) return null;
  return sqrt(mul(seA, seA) + mul(seB, seB));
}

export type DivergenceTest = {
  /** Observed gap, `a` minus `b`. */
  gapFx: bigint | null;
  /** Standard error of that gap. */
  seFx: bigint | null;
  /** |gap| / se, how many standard errors apart the two arms are. */
  sigmaFx: bigint | null;
  /** True when the gap exceeds SIGMA_MULTIPLIER standard errors. */
  significant: boolean;
};

export function testDifference(
  a: bigint | null,
  b: bigint | null,
  seA: bigint | null,
  seB: bigint | null,
): DivergenceTest {
  if (a === null || b === null) {
    return { gapFx: null, seFx: null, sigmaFx: null, significant: false };
  }
  const gapFx = a - b;
  const seFx = differenceStandardError(seA, seB);
  if (seFx === null || seFx === 0n) {
    // With no usable uncertainty estimate, refuse to call it significant
    // rather than declaring divergence on an unmeasurable basis.
    return { gapFx, seFx, sigmaFx: null, significant: false };
  }
  const abs = gapFx < 0n ? -gapFx : gapFx;
  const sigmaFx = div(abs, seFx);
  return { gapFx, seFx, sigmaFx, significant: sigmaFx > SIGMA_MULTIPLIER * ONE };
}

export { ratio as divergenceRatio };
