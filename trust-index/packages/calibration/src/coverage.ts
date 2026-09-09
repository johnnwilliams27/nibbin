/**
 * Coverage analysis: how many agents does the methodology actually score?
 *
 * The sensitivity and joint sweeps answer "how far does a score move". They say
 * nothing about how many agents get a score at all, and on the real Base
 * registry that turned out to be the more consequential question: a uniform
 * 2,000-agent sample produced 15 published scores. A band around a number
 * almost nobody has is not the headline.
 *
 * Suppression is not one decision. An agent falls out at whichever of these
 * comes first, and the report separates them because they have different fixes:
 *
 *   1. no feedback at all                 nothing to score, and no constant changes that
 *   2. no usable feedback                 every entry revoked, or its scale uninferable
 *                                         (SPEC 11.10 excludes rather than guesses)
 *   3. n_eff below the suppression floor  evidence exists but is not weighty enough
 *
 * Stage 3 is where a constant choice decides coverage, so it is reported
 * against variations rather than at the default alone. Two of those variations
 * exist to bound an artifact rather than to propose a setting: an index build
 * that cannot date a reviewer's wallet accurately understates the age ramp, and
 * one that reads a long history understates nothing but still applies decay.
 * Running with each disabled separates "the methodology suppresses this agent"
 * from "our inputs are thin", which a single coverage number cannot do.
 */
import { score } from "@trust-index/scoring";
import type { AgentSnapshot, MethodologyConstants } from "@trust-index/types";

export type CoverageStage = {
  /** Agents in the cohort. */
  total: number;
  /** Agents carrying at least one feedback entry. */
  withFeedback: number;
  /** Agents carrying at least one entry that is neither revoked nor scale-uninferable. */
  withUsableFeedback: number;
  /** Agents receiving a non-null published score. */
  scored: number;
  /** Distinct published score values, which bounds how finely the index can rank. */
  distinctScores: number;
  /** Mean n_eff across the cohort, on the same scale as the suppression floor. */
  meanNeff: number;
  /** Largest n_eff any agent reaches. */
  maxNeff: number;
  /** Agent counts by coverage tier. */
  tiers: Array<{ tier: string; count: number }>;
};

export type CoverageVariation = {
  label: string;
  /** What the variation is for: a proposed setting, or bounding an input artifact. */
  purpose: "baseline" | "artifact_bound" | "constant_variation";
  scored: number;
  meanNeff: number;
};

export type CoverageReport = {
  baseline: CoverageStage;
  variations: CoverageVariation[];
  /** Distinct reviewers per agent, for agents that have any. */
  reviewersPerAgent: { agents: number; median: number; p90: number; max: number; exactlyOne: number };
};

function withConstants(s: AgentSnapshot, mut: (c: MethodologyConstants) => void): AgentSnapshot {
  const c = JSON.parse(JSON.stringify(s.constants)) as MethodologyConstants;
  mut(c);
  return { ...s, constants: c };
}

function measure(cohort: readonly AgentSnapshot[], transform: (s: AgentSnapshot) => AgentSnapshot) {
  let scored = 0;
  let neffSum = 0;
  let maxNeff = 0;
  const distinct = new Set<string>();
  const tiers = new Map<string, number>();
  for (const s of cohort) {
    const { result } = score(transform(s));
    tiers.set(result.coverage_tier, (tiers.get(result.coverage_tier) ?? 0) + 1);
    if (result.score !== null) {
      scored += 1;
      distinct.add(result.score.toFixed(2));
    }
    const neff = Number(result.n_eff);
    neffSum += neff;
    if (neff > maxNeff) maxNeff = neff;
  }
  return {
    scored,
    distinct: distinct.size,
    meanNeff: cohort.length === 0 ? 0 : neffSum / cohort.length,
    maxNeff,
    tiers: [...tiers].sort((a, b) => b[1] - a[1]).map(([tier, count]) => ({ tier, count })),
  };
}

export function analyzeCoverage(cohort: readonly AgentSnapshot[]): CoverageReport {
  const identity = (s: AgentSnapshot) => s;
  const base = measure(cohort, identity);

  let withFeedback = 0;
  let withUsableFeedback = 0;
  for (const s of cohort) {
    if (s.feedback.length > 0) withFeedback += 1;
    if (s.feedback.some((f) => !f.is_revoked && f.detected_scale !== null)) withUsableFeedback += 1;
  }

  const variations: CoverageVariation[] = [];
  const add = (label: string, purpose: CoverageVariation["purpose"], t: (s: AgentSnapshot) => AgentSnapshot) => {
    const m = measure(cohort, t);
    variations.push({ label, purpose, scored: m.scored, meanNeff: m.meanNeff });
  };

  add("baseline constants", "baseline", identity);
  add("age ramp removed (age_floor = 1.00)", "artifact_bound", (s) =>
    withConstants(s, (c) => {
      c.weight.age_floor = { ...c.weight.age_floor, value: "1.00" };
    }),
  );
  add("time decay removed (half life 100000 days)", "artifact_bound", (s) =>
    withConstants(s, (c) => {
      c.decay_half_life_days = { ...c.decay_half_life_days, value: "100000" };
    }),
  );
  add("age ramp and decay both removed", "artifact_bound", (s) =>
    withConstants(s, (c) => {
      c.weight.age_floor = { ...c.weight.age_floor, value: "1.00" };
      c.decay_half_life_days = { ...c.decay_half_life_days, value: "100000" };
    }),
  );
  add("suppression floor halved (0.25)", "constant_variation", (s) =>
    withConstants(s, (c) => {
      c.suppression_neff_floor = { ...c.suppression_neff_floor, value: "0.25" };
    }),
  );
  add("suppression floor effectively removed (0.01)", "constant_variation", (s) =>
    withConstants(s, (c) => {
      c.suppression_neff_floor = { ...c.suppression_neff_floor, value: "0.01" };
    }),
  );

  const counts = cohort
    .map((s) => Object.keys(s.reviewers).length)
    .filter((n) => n > 0)
    .sort((a, b) => a - b);
  const at = (q: number) => (counts.length === 0 ? 0 : counts[Math.min(counts.length - 1, Math.floor(counts.length * q))]!);

  return {
    baseline: {
      total: cohort.length,
      withFeedback,
      withUsableFeedback,
      scored: base.scored,
      distinctScores: base.distinct,
      meanNeff: base.meanNeff,
      maxNeff: base.maxNeff,
      tiers: base.tiers,
    },
    variations,
    reviewersPerAgent: {
      agents: counts.length,
      median: at(0.5),
      p90: at(0.9),
      max: counts.length === 0 ? 0 : counts[counts.length - 1]!,
      exactlyOne: counts.filter((c) => c === 1).length,
    },
  };
}
