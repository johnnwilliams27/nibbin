/**
 * Rank stability under a constant sweep.
 *
 * The sensitivity sweep already measures how far scores MOVE when a constant
 * changes. That is the right question when the published number is read as a
 * magnitude and the wrong one when it is read as an ordering. A constant that
 * shifts every agent twelve points in the same direction moves the score a
 * great deal and the ranking not at all: "agent A is better than agent B"
 * survives it untouched, and so does "this agent is in the top decile".
 *
 * Those are different claims carrying different uncertainties, and until now
 * only the first was measured. A methodology page that reports a wide score
 * band without saying whether the ordering moved with it overstates the damage
 * an unverified constant does to a comparison, and understates the value of
 * what the index can already support.
 *
 * Five measures, each answering a claim a reader might want to make:
 *
 * - Pair agreement: of every pair the baseline orders, how many are still
 *   ordered the same way. This is the "is A better than B" claim.
 * - Agreement by separation: the same measure restricted to pairs the baseline
 *   separates by at least some margin. Two agents a hundredth of a point apart
 *   are not a comparison anyone would make, and counting that pair alongside
 *   one thirty points apart understates how usable the ordering is. The useful
 *   output is the margin at which comparisons become safe from the constant.
 * - Spearman correlation: how much the whole ordering moves, in the standard
 *   form so it can be compared against other work.
 * - Top-decile retention: of the agents the baseline puts in the top decile,
 *   how many are still there. This is the "is this agent among the best"
 *   claim, which is what a consumer gating on a threshold actually asks.
 * - Maximum rank shift: the worst single displacement, because a mean can hide
 *   one agent moving from second to two hundredth.
 *
 * None of this needs commerce labels, so it is available now, before
 * calibration. It measures stability, never correctness: an ordering can be
 * perfectly stable under every constant and still be the wrong ordering. Only
 * calibration against real outcomes speaks to that.
 */
import { ONE, isqrt, parse } from "./fixed.js";
import { divRoundHalfUp } from "@trust-index/types";

/**
 * Pair agreement restricted to pairs the baseline separates by at least
 * `minGapFx` points. The margin at which agreement becomes reliable is the
 * practical output: it says how far apart two agents must be before their
 * ordering can be quoted without depending on an unverified constant.
 */
export type SeparationPoint = {
  /** Minimum baseline score gap, SCALE-scaled, on the 0-100 display scale. */
  minGapFx: bigint;
  /** Pairs the baseline separates by at least this margin. */
  orderedPairs: number;
  agreedPairs: number;
  invertedPairs: number;
  /** agreedPairs / orderedPairs. Null when no pair is separated this far. */
  agreementFx: bigint | null;
};

/**
 * Default margins, in published score points. Zero reproduces the unrestricted
 * agreement; the rest span the range from "adjacent" to "obviously different".
 * These are reporting choices for this analysis, not methodology constants.
 */
export const DEFAULT_SEPARATIONS: readonly string[] = ["0", "1", "2", "5", "10", "20"];

export type RankStability = {
  /** Agents ranked at both settings. */
  comparable: number;
  /** Agents dropped because they are suppressed at one setting and not the other. */
  excluded: number;
  /** Pairs the baseline orders strictly. The denominator for pair agreement. */
  orderedPairs: number;
  /** Ordered pairs the swept setting orders the same way. */
  agreedPairs: number;
  /** Ordered pairs the swept setting orders the opposite way. */
  invertedPairs: number;
  /** Ordered pairs the swept setting ties, so it makes no claim either way. */
  tiedPairs: number;
  /** agreedPairs / orderedPairs. Null when the baseline orders no pair. */
  pairAgreementFx: bigint | null;
  /** Agreement restricted to progressively wider baseline score gaps. */
  separation: SeparationPoint[];
  /** Spearman rank correlation on [-1, 1]. Null when either side has no variation. */
  spearmanFx: bigint | null;
  /** Agents in the baseline's top decile, by score threshold rather than by count. */
  topDecileBaseline: number;
  /** Agents in the swept setting's top decile. */
  topDecileSwept: number;
  /** Baseline top-decile agents still in the swept top decile. */
  topDecileRetained: number;
  /** Largest rank displacement any single agent suffers. */
  maxRankShift: number;
};

/**
 * Reduce a SCALE-scaled score to whole centipoints.
 *
 * Ranking compares the score as published, at two decimal places, because that
 * is the ordering a reader can actually see: two agents separated at the tenth
 * decimal are tied as far as anyone consuming the index is concerned. The
 * division is exact integer arithmetic, so this introduces no float and no
 * rounding choice of its own.
 */
function centipoints(scoreFx: bigint): number {
  return Number(divRoundHalfUp(scoreFx, 10n ** 10n));
}

/**
 * Competition ranking, 1 for the highest score, ties sharing a rank.
 *
 * Ties get the same rank (1 plus the count of strictly greater scores) rather
 * than an order imposed by position in the cohort. An arbitrary tiebreak would
 * manufacture rank movement out of agents that never actually moved.
 */
function competitionRanks(values: readonly number[]): number[] {
  return values.map((v) => 1 + values.reduce((n, other) => (other > v ? n + 1 : n), 0));
}

/**
 * Average ranks, doubled to stay integral. Ties take the mean of the ranks they
 * span, which is what Spearman's tie correction requires; doubling keeps the
 * halves out of the arithmetic.
 */
function doubledAverageRanks(values: readonly number[]): bigint[] {
  const order = values.map((_, i) => i).sort((a, b) => values[a]! - values[b]! || a - b);
  const out = new Array<bigint>(values.length).fill(0n);
  let i = 0;
  while (i < order.length) {
    let j = i + 1;
    while (j < order.length && values[order[j]!] === values[order[i]!]) j += 1;
    // Ranks i+1 .. j inclusive (1-based); their mean, doubled, is (i+1) + j.
    const doubled = BigInt(i + 1) + BigInt(j);
    for (let k = i; k < j; k += 1) out[order[k]!] = doubled;
    i = j;
  }
  return out;
}

/**
 * Pearson correlation over two integer vectors, returned SCALE-scaled.
 *
 * Applied to rank vectors this is Spearman's rho with the standard tie
 * correction. Everything is held in exact integers until the final division:
 * r = (n*Sxy - Sx*Sy) / sqrt((n*Sxx - Sx^2) * (n*Syy - Sy^2)).
 */
function pearsonFx(x: readonly bigint[], y: readonly bigint[]): bigint | null {
  const len = x.length;
  if (len < 2) return null;
  const n = BigInt(len);
  let sx = 0n;
  let sy = 0n;
  let sxy = 0n;
  let sxx = 0n;
  let syy = 0n;
  for (let i = 0; i < len; i += 1) {
    const a = x[i]!;
    const b = y[i]!;
    sx += a;
    sy += b;
    sxy += a * b;
    sxx += a * a;
    syy += b * b;
  }
  const numerator = n * sxy - sx * sy;
  const varX = n * sxx - sx * sx;
  const varY = n * syy - sy * sy;
  // No variation on one side means every agent is tied there, so there is no
  // ordering to correlate with. Undefined rather than zero.
  if (varX <= 0n || varY <= 0n) return null;
  const denominator = isqrt(varX * varY);
  if (denominator === 0n) return null;
  return divRoundHalfUp(numerator * ONE, denominator);
}

/**
 * The top decile by score threshold, not by count.
 *
 * Taking the k highest would need a tiebreak at the boundary, and the tiebreak
 * would then show up as retention churn among agents whose scores never
 * changed. Taking everyone at or above the k-th highest score can return more
 * than k agents, which is the honest reading of a tie at the cut line.
 */
function topDecile(values: readonly number[]): Set<number> {
  const out = new Set<number>();
  if (values.length === 0) return out;
  const k = Math.max(1, Math.ceil(values.length / 10));
  const sorted = [...values].sort((a, b) => b - a);
  const threshold = sorted[k - 1]!;
  values.forEach((v, i) => {
    if (v >= threshold) out.add(i);
  });
  return out;
}

/**
 * Compare a swept setting's ordering against the baseline's.
 *
 * Inputs are SCALE-scaled published scores, index-aligned, with null for an
 * agent the setting suppresses. An agent suppressed at one setting and not the
 * other has no rank to compare, so it is excluded and counted: a suppression
 * flip is a real effect, but it is a coverage effect and `suppressionFlips`
 * already reports it.
 */
export function rankStability(
  baseline: readonly (bigint | null)[],
  swept: readonly (bigint | null)[],
  options: { separationsPoints?: readonly string[] } = {},
): RankStability {
  if (baseline.length !== swept.length) {
    throw new RangeError(`rankStability: length mismatch, ${baseline.length} against ${swept.length}`);
  }
  // Margins in whole centipoints, ascending, so the pairwise loop can bucket a
  // gap by walking upward until it stops qualifying.
  const separations = [...(options.separationsPoints ?? DEFAULT_SEPARATIONS)]
    .map((s) => centipoints(parse(s)))
    .sort((a, b) => a - b);

  const b: number[] = [];
  const s: number[] = [];
  let excluded = 0;
  for (let i = 0; i < baseline.length; i += 1) {
    const bv = baseline[i]!;
    const sv = swept[i]!;
    if (bv === null || sv === null) {
      if (bv !== null || sv !== null) excluded += 1;
      continue;
    }
    b.push(centipoints(bv));
    s.push(centipoints(sv));
  }

  const empty: RankStability = {
    comparable: b.length,
    excluded,
    orderedPairs: 0,
    agreedPairs: 0,
    invertedPairs: 0,
    tiedPairs: 0,
    pairAgreementFx: null,
    separation: separations.map((c) => ({
      minGapFx: BigInt(c) * 10n ** 10n,
      orderedPairs: 0,
      agreedPairs: 0,
      invertedPairs: 0,
      agreementFx: null,
    })),
    spearmanFx: null,
    topDecileBaseline: 0,
    topDecileSwept: 0,
    topDecileRetained: 0,
    maxRankShift: 0,
  };
  if (b.length < 2) return empty;

  // Pairwise agreement. Quadratic in the cohort, which is affordable because
  // the comparison runs on whole integers and the cohort is bounded by the
  // registry. If that stops being true, this is the loop to replace with
  // inversion counting.
  let orderedPairs = 0;
  let agreedPairs = 0;
  let invertedPairs = 0;
  let tiedPairs = 0;
  const sepOrdered = new Array<number>(separations.length).fill(0);
  const sepAgreed = new Array<number>(separations.length).fill(0);
  const sepInverted = new Array<number>(separations.length).fill(0);
  for (let i = 0; i < b.length; i += 1) {
    for (let j = i + 1; j < b.length; j += 1) {
      const baseCmp = b[i]! - b[j]!;
      if (baseCmp === 0) continue; // the baseline makes no claim about this pair
      orderedPairs += 1;
      const sweptCmp = s[i]! - s[j]!;
      const agreed = sweptCmp !== 0 && baseCmp > 0 === sweptCmp > 0;
      const inverted = sweptCmp !== 0 && !agreed;
      if (sweptCmp === 0) tiedPairs += 1;
      else if (agreed) agreedPairs += 1;
      else invertedPairs += 1;

      // Credit this pair to every margin it clears. Margins are ascending, so
      // the first one it fails ends the walk.
      const gap = baseCmp < 0 ? -baseCmp : baseCmp;
      for (let t = 0; t < separations.length && gap >= separations[t]!; t += 1) {
        sepOrdered[t]! += 1;
        if (agreed) sepAgreed[t]! += 1;
        else if (inverted) sepInverted[t]! += 1;
      }
    }
  }

  const ranksB = competitionRanks(b);
  const ranksS = competitionRanks(s);
  let maxRankShift = 0;
  for (let i = 0; i < ranksB.length; i += 1) {
    const shift = Math.abs(ranksB[i]! - ranksS[i]!);
    if (shift > maxRankShift) maxRankShift = shift;
  }

  const decileB = topDecile(b);
  const decileS = topDecile(s);
  let retained = 0;
  for (const i of decileB) if (decileS.has(i)) retained += 1;

  return {
    comparable: b.length,
    excluded,
    orderedPairs,
    agreedPairs,
    invertedPairs,
    tiedPairs,
    pairAgreementFx: orderedPairs === 0 ? null : divRoundHalfUp(BigInt(agreedPairs) * ONE, BigInt(orderedPairs)),
    separation: separations.map((c, t) => ({
      minGapFx: BigInt(c) * 10n ** 10n,
      orderedPairs: sepOrdered[t]!,
      agreedPairs: sepAgreed[t]!,
      invertedPairs: sepInverted[t]!,
      agreementFx:
        sepOrdered[t]! === 0 ? null : divRoundHalfUp(BigInt(sepAgreed[t]!) * ONE, BigInt(sepOrdered[t]!)),
    })),
    spearmanFx: pearsonFx(doubledAverageRanks(b), doubledAverageRanks(s)),
    topDecileBaseline: decileB.size,
    topDecileSwept: decileS.size,
    topDecileRetained: retained,
    maxRankShift,
  };
}
