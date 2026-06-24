/**
 * stakes-score.ts — real stakes scoring for field conflicts (C2 follow-up).
 *
 * Replaces the hardcoded `stakes='high' iff fieldKey ∈ {pricing,policies,
 * hard_rules}` rule with a weighted score over the signals that actually make
 * a conflict consequential:
 *
 *   1. Field criticality   — pricing/policies/hard_rules are inherently
 *                            high-consequence (the strongest single signal).
 *   2. Competing-source #   — more independent sources disagreeing = more real.
 *   3. Authority spread     — a conflict among HIGH-authority sources (e.g. a
 *                            document vs a document) matters more than a
 *                            low-trust observation disagreeing with a doc.
 *   4. Divergence magnitude — number of distinct normalized values (a 3-way
 *                            split is higher-stakes than a 2-way).
 *
 * Output domain is deliberately the existing two levels ('normal' | 'high')
 * that the notifications CHECK, flag_field_conflict RPC, and P6 attention queue
 * already expect. Scoring is the internal upgrade; the contract is unchanged.
 *
 * Pure TypeScript — no I/O, no model calls, no DB. Deterministic.
 */

import type { SourceKind } from './conflict-detect';

// ── Types ─────────────────────────────────────────────────────────────────────

/** Inputs to the stakes score for one detected conflict. */
export interface StakesSignals {
  /** The field in conflict (e.g. 'pricing'). */
  fieldKey: string;
  /**
   * The source kinds of the competing contributions (one entry per competing
   * source; duplicates are meaningful — two documents disagreeing is a signal).
   */
  competingKinds: SourceKind[];
  /** Count of DISTINCT normalized values among the competitors (≥0). */
  distinctValueCount: number;
  /** Per-kind authority weights (0..100), same map conflict detection uses. */
  authority: Record<SourceKind, number>;
}

// ── Constants ─────────────────────────────────────────────────────────────────

/**
 * Fields whose conflicts are inherently high-consequence. A conflict on any of
 * these is ALWAYS high regardless of the other signals — getting pricing,
 * policy, or a hard rule wrong has direct business/trust cost.
 */
const CRITICAL_FIELDS = new Set(['pricing', 'policies', 'hard_rules']);

/** Authority weight at/above which a source counts as "high authority". */
const HIGH_AUTHORITY_THRESHOLD = 60;

/**
 * Score at/above which a non-critical conflict escalates to 'high'. Tuned so a
 * lone low-trust 2-way disagreement stays 'normal' but a multi-source or
 * high-authority or multi-way divergence crosses the line.
 */
const HIGH_STAKES_THRESHOLD = 5;

// Per-signal point weights. Documented, fixed constants (not learned) —
// mirrors the deterministic, non-ML stance of the router's reinforcement.
const POINTS = {
  /** Each competing source beyond the first. */
  perExtraSource: 2,
  /** Each high-authority source in the conflict. */
  perHighAuthoritySource: 2,
  /** Each distinct value beyond the two that a minimal conflict has. */
  perExtraDistinctValue: 2,
} as const;

// ── Core ──────────────────────────────────────────────────────────────────────

/**
 * Score a single conflict to one of the existing stakes levels.
 *
 * Critical fields short-circuit to 'high'. Otherwise we sum the weighted
 * signals and threshold. Fail-safe: unknown/missing kinds contribute 0
 * authority points rather than throwing.
 */
export function scoreStakes(s: StakesSignals): 'normal' | 'high' {
  // 1. Field criticality — strongest signal, short-circuits.
  if (CRITICAL_FIELDS.has(s.fieldKey)) return 'high';

  let score = 0;

  // 2. Competing-source count — points for each source beyond the first.
  const extraSources = Math.max(0, s.competingKinds.length - 1);
  score += extraSources * POINTS.perExtraSource;

  // 3. Authority spread — points for each high-authority source in the conflict.
  for (const kind of s.competingKinds) {
    const weight = s.authority[kind];
    if (typeof weight === 'number' && weight >= HIGH_AUTHORITY_THRESHOLD) {
      score += POINTS.perHighAuthoritySource;
    }
  }

  // 4. Divergence magnitude — points for each distinct value beyond the
  //    minimal two a 2-way conflict has.
  const extraDistinct = Math.max(0, s.distinctValueCount - 2);
  score += extraDistinct * POINTS.perExtraDistinctValue;

  return score >= HIGH_STAKES_THRESHOLD ? 'high' : 'normal';
}
