/**
 * Joint constant sweep.
 *
 * The one-constant-at-a-time sweep in sensitivity.ts answers "what does this
 * constant cost me", and that is the right question when attributing risk to a
 * particular unverified value. It is the wrong question when publishing an
 * uncertainty band, because the constants are all unverified at once: two of
 * them moving together can disturb a pair that neither disturbs alone, so a
 * per-constant margin is a lower bound on the joint one, never an upper bound.
 *
 * This module varies every constant simultaneously and reports what survives.
 *
 * Aggregation is per pair, not per draw. An earlier version took the worst
 * pair agreement across draws, and the answer was dominated by a single
 * degenerate draw: at the extreme corner of the grid almost every agent is
 * suppressed, two survive, their one comparison flips, and the reported
 * agreement is zero on a sample of one pair. That number said nothing about the
 * ordering and everything about the coverage collapse. So the statistic is now
 * the fraction of PAIRS whose ordering holds in every draw that could evaluate
 * them, which is the claim a reader wants: if these two agents are ten points
 * apart, does their ordering depend on constants nobody has checked?
 *
 * A pair is counted as holding only when the swept setting orders it the same
 * way. A setting that ties the pair does not support the claim "A ranks above
 * B" and is counted against it.
 *
 * Two honesty constraints shape the rest.
 *
 * The full grid is not enumerated. Eight axes at three to five values each is
 * tens of thousands of combinations, and rescoring a real cohort that many
 * times is not affordable. So the space is sampled, deterministically, from a
 * seeded generator with no clock and no platform randomness: the same seed and
 * cohort reproduce the same band exactly. The corners of the grid, all axes at
 * their lowest and all at their highest, are always included, because an
 * extreme is a plausible worst case and a sample can miss it.
 *
 * A sample gives a lower bound on the worst case, and the report says so. A
 * draw worse than every one taken is always possible. The bound tightens with
 * more draws and never becomes a proof.
 */
import type { AgentSnapshot, MethodologyConstants } from "@trust-index/types";
import { score } from "@trust-index/scoring";
import { divRoundHalfUp } from "@trust-index/types";
import { ONE, divInt, parse } from "./fixed.js";
import { DEFAULT_SEPARATIONS } from "./rank.js";
import { DEFAULT_SWEEPS, type ConstantPath } from "./sensitivity.js";

/** Numerical Recipes LCG. Deterministic, no clock, no platform randomness. */
function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(1664525, s) + 1013904223) >>> 0;
    return s / 0x1_0000_0000;
  };
}

export type JointAxis = { path: ConstantPath; values: readonly string[] };

/** How pairs at one separation margin fared across every draw. */
export type PairSurvival = {
  /** Minimum baseline score gap, SCALE-scaled, on the 0-100 display scale. */
  minGapFx: bigint;
  /** Tracked pairs at least this far apart that at least one draw could evaluate. */
  pairs: number;
  /** Of those, pairs whose ordering held in every draw that evaluated them. */
  alwaysHeld: number;
  /** alwaysHeld / pairs. Null when no pair at this margin was evaluable. */
  survivalFx: bigint | null;
  /** Pairs at this margin that no draw could evaluate, because of suppression. */
  neverEvaluable: number;
};

export type JointSweepResult = {
  seed: number;
  /** Draws actually evaluated, including the two grid corners. */
  draws: number;
  /** Total size of the joint grid, for reading the sample against the space. */
  gridSize: number;
  axes: readonly JointAxis[];
  /** Agents in the cohort. */
  cohortSize: number;
  /** Ordered pairs tracked across draws. */
  trackedPairs: number;
  /** Ordered pairs the cohort contains, before any sampling. */
  totalOrderedPairs: number;
  /** True when trackedPairs is a deterministic sample rather than every pair. */
  pairsSampled: boolean;

  /** Worst mean absolute score movement across draws, 0-100 scale. */
  worstMeanAbsDeltaFx: bigint;
  /** Agents the worst-movement draw could compare. Small means it also collapsed coverage. */
  worstMeanAbsDeltaCompared: number;
  worstMaxAbsDeltaFx: bigint;
  worstTierChanges: number;
  worstSuppressionFlips: number;
  /** Fewest agents any draw left scored, which is how far coverage can collapse. */
  fewestScored: number;

  separation: PairSurvival[];
  /**
   * Narrowest margin at which pair survival reaches the threshold. Null when no
   * tested margin reaches it, meaning no comparison is safe from the joint
   * constant choice at any separation measured.
   */
  safeSeparationFx: bigint | null;

  /** The draw producing the worst score movement, so it can be reproduced. */
  worstScoreDraw: Record<string, string> | null;
};

function withConstants(base: MethodologyConstants, assignment: Record<string, string>): MethodologyConstants {
  const next: MethodologyConstants = JSON.parse(JSON.stringify(base)) as MethodologyConstants;
  for (const [path, value] of Object.entries(assignment)) {
    const dot = path.indexOf(".");
    if (dot === -1) {
      const key = path as "shrinkage_k" | "decay_half_life_days" | "suppression_neff_floor";
      next[key] = { ...next[key], value };
      continue;
    }
    const group = path.slice(0, dot) as "weight" | "tiers" | "lifecycle";
    const key = path.slice(dot + 1);
    const bucket = next[group] as unknown as Record<string, { value: string }>;
    if (!Object.hasOwn(bucket, key)) throw new Error(`unknown constant path: ${path}`);
    bucket[key] = { ...bucket[key]!, value };
  }
  return next;
}

type Observed = { scoreFx: bigint | null; tier: string };

function observe(cohort: readonly AgentSnapshot[], constants: MethodologyConstants): Observed[] {
  return cohort.map((s) => {
    const { result } = score({ ...s, constants });
    return {
      scoreFx: result.score === null ? null : parse(result.score.toFixed(2)),
      tier: result.coverage_tier,
    };
  });
}

/** Reduce a SCALE-scaled score to whole centipoints, the published precision. */
function centipoints(scoreFx: bigint): number {
  return Number(divRoundHalfUp(scoreFx, 10n ** 10n));
}

/**
 * Vary every constant at once and report what survives.
 *
 * `draws` counts sampled combinations; the two grid corners are added on top of
 * them and are always evaluated. Duplicate draws are kept rather than rejected,
 * because rejection sampling would make the evaluated count depend on
 * collisions and so on the seed, which is a needless source of
 * irreproducibility.
 *
 * `maxPairs` bounds the pairwise tracking. Below it every ordered pair is
 * tracked; above it pairs are included by a deterministic filter, and the
 * result records that it sampled. Pair enumeration is quadratic in the cohort
 * and runs once, which is affordable for a registry-sized population and would
 * need a different approach well beyond one.
 */
export function jointSweep(
  cohort: readonly AgentSnapshot[],
  options: {
    axes?: readonly JointAxis[];
    draws?: number;
    seed?: number;
    survivalThreshold?: string;
    separationsPoints?: readonly string[];
    maxPairs?: number;
  } = {},
): JointSweepResult {
  if (cohort.length === 0) throw new RangeError("jointSweep: empty cohort");
  const axes = options.axes ?? DEFAULT_SWEEPS;
  if (axes.length === 0) throw new RangeError("jointSweep: no axes to vary");
  for (const a of axes) {
    if (a.values.length === 0) throw new RangeError(`jointSweep: axis ${a.path} has no values`);
  }
  const drawCount = options.draws ?? 500;
  const seed = options.seed ?? 1;
  const survivalThreshold = parse(options.survivalThreshold ?? "0.99");
  const maxPairs = options.maxPairs ?? 200_000;
  const margins = [...(options.separationsPoints ?? DEFAULT_SEPARATIONS)]
    .map((s) => centipoints(parse(s)))
    .sort((a, b) => a - b);

  const base = cohort[0]!.constants;
  const baseline = observe(cohort, base);
  const baselineCp = baseline.map((o) => (o.scoreFx === null ? null : centipoints(o.scoreFx)));

  // Pairs the baseline orders strictly. A pair the baseline ties carries no
  // ordering claim, so there is nothing for a constant to disturb.
  let totalOrderedPairs = 0;
  const pairI: number[] = [];
  const pairJ: number[] = [];
  const pairGap: number[] = [];
  const pairRand = lcg(seed ^ 0x5f3759df);
  // Two passes so the inclusion probability can be set from the true total.
  for (let i = 0; i < baselineCp.length; i += 1) {
    const a = baselineCp[i]!;
    if (a === null) continue;
    for (let j = i + 1; j < baselineCp.length; j += 1) {
      const b = baselineCp[j]!;
      if (b === null || a === b) continue;
      totalOrderedPairs += 1;
    }
  }
  const inclusion = totalOrderedPairs <= maxPairs ? 1 : maxPairs / totalOrderedPairs;
  for (let i = 0; i < baselineCp.length; i += 1) {
    const a = baselineCp[i]!;
    if (a === null) continue;
    for (let j = i + 1; j < baselineCp.length; j += 1) {
      const b = baselineCp[j]!;
      if (b === null || a === b) continue;
      if (inclusion < 1 && pairRand() >= inclusion) continue;
      pairI.push(i);
      pairJ.push(j);
      pairGap.push(a > b ? a - b : b - a);
    }
  }
  const tracked = pairI.length;
  // Per-pair state across draws: how many draws could evaluate it, and whether
  // any of them failed to reproduce the baseline ordering.
  const pairEvaluated = new Int32Array(tracked);
  const pairBroken = new Uint8Array(tracked);

  const rand = lcg(seed);
  const assignments: Array<Record<string, string>> = [];
  assignments.push(Object.fromEntries(axes.map((a) => [a.path, a.values[0]!])));
  assignments.push(Object.fromEntries(axes.map((a) => [a.path, a.values[a.values.length - 1]!])));
  for (let d = 0; d < drawCount; d += 1) {
    assignments.push(
      Object.fromEntries(axes.map((a) => [a.path, a.values[Math.floor(rand() * a.values.length)]!])),
    );
  }

  let worstMeanAbsDeltaFx = 0n;
  let worstMeanAbsDeltaCompared = 0;
  let worstMaxAbsDeltaFx = 0n;
  let worstTierChanges = 0;
  let worstSuppressionFlips = 0;
  let fewestScored = Number.MAX_SAFE_INTEGER;
  let worstScoreDraw: Record<string, string> | null = null;

  for (const assignment of assignments) {
    const observed = observe(cohort, withConstants(base, assignment));
    let sumAbs = 0n;
    let maxAbs = 0n;
    let compared = 0;
    let tierChanges = 0;
    let suppressionFlips = 0;
    let scored = 0;
    observed.forEach((o, i) => {
      const b = baseline[i]!;
      if (o.scoreFx !== null) scored += 1;
      if (o.tier !== b.tier) tierChanges += 1;
      if ((o.scoreFx === null) !== (b.scoreFx === null)) suppressionFlips += 1;
      if (o.scoreFx !== null && b.scoreFx !== null) {
        const delta = o.scoreFx - b.scoreFx;
        const abs = delta < 0n ? -delta : delta;
        sumAbs += abs;
        if (abs > maxAbs) maxAbs = abs;
        compared += 1;
      }
    });
    const meanAbs = compared === 0 ? 0n : divInt(sumAbs, BigInt(compared));

    if (meanAbs > worstMeanAbsDeltaFx) {
      worstMeanAbsDeltaFx = meanAbs;
      worstMeanAbsDeltaCompared = compared;
      worstScoreDraw = assignment;
    }
    if (maxAbs > worstMaxAbsDeltaFx) worstMaxAbsDeltaFx = maxAbs;
    if (tierChanges > worstTierChanges) worstTierChanges = tierChanges;
    if (suppressionFlips > worstSuppressionFlips) worstSuppressionFlips = suppressionFlips;
    if (scored < fewestScored) fewestScored = scored;

    const cp = observed.map((o) => (o.scoreFx === null ? null : centipoints(o.scoreFx)));
    for (let p = 0; p < tracked; p += 1) {
      const i = pairI[p]!;
      const j = pairJ[p]!;
      const a = cp[i]!;
      const b = cp[j]!;
      // Suppression removes the comparison rather than breaking it: there is no
      // ordering to disagree with. That is a coverage effect, reported by
      // worstSuppressionFlips and fewestScored.
      if (a === null || b === null) continue;
      pairEvaluated[p]! += 1;
      if (pairBroken[p] === 1) continue;
      const baseAhead = baselineCp[i]! > baselineCp[j]!;
      // A tie does not support the ordering claim, so it counts against it.
      if (a === b || a > b !== baseAhead) pairBroken[p] = 1;
    }
  }

  const separation: PairSurvival[] = margins.map((minGap) => {
    let pairs = 0;
    let alwaysHeld = 0;
    let neverEvaluable = 0;
    for (let p = 0; p < tracked; p += 1) {
      if (pairGap[p]! < minGap) continue;
      if (pairEvaluated[p]! === 0) {
        neverEvaluable += 1;
        continue;
      }
      pairs += 1;
      if (pairBroken[p] === 0) alwaysHeld += 1;
    }
    return {
      minGapFx: BigInt(minGap) * 10n ** 10n,
      pairs,
      alwaysHeld,
      survivalFx: pairs === 0 ? null : divRoundHalfUp(BigInt(alwaysHeld) * ONE, BigInt(pairs)),
      neverEvaluable,
    };
  });

  let safeSeparationFx: bigint | null = null;
  for (const s of separation) {
    if (s.survivalFx !== null && s.survivalFx >= survivalThreshold) {
      safeSeparationFx = s.minGapFx;
      break;
    }
  }

  return {
    seed,
    draws: assignments.length,
    gridSize: axes.reduce((n, a) => n * a.values.length, 1),
    axes,
    cohortSize: cohort.length,
    trackedPairs: tracked,
    totalOrderedPairs,
    pairsSampled: inclusion < 1,
    worstMeanAbsDeltaFx,
    worstMeanAbsDeltaCompared,
    worstMaxAbsDeltaFx,
    worstTierChanges,
    worstSuppressionFlips,
    fewestScored: fewestScored === Number.MAX_SAFE_INTEGER ? 0 : fewestScored,
    separation,
    safeSeparationFx,
    worstScoreDraw,
  };
}
