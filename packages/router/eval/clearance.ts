/**
 * The clearance rule — the ONE place "cleared" is decided, computed from the
 * aggregate judge scores (never hardcoded). Pure + deterministic.
 *
 *  - A CHEAPER ('cost') challenger CLEARS when its aggregate is within
 *    `qualityTolerance` of, OR above, the incumbent's — a P8 cost win at no
 *    meaningful quality loss.
 *  - A quality-headroom ('quality') challenger CLEARS only when its aggregate
 *    is ≥ the incumbent's (it must actually be at least as good — no tolerance
 *    slack, since the point is quality, not cost).
 *
 * The band is half-open exactly at the bar: a 'cost' challenger exactly
 * `qualityTolerance` below the incumbent still clears (incumbent − challenger
 * ≤ tolerance); one a hair more below does not. A 'quality' challenger exactly
 * equal to the incumbent clears (≥); below does not.
 */
import type { ChallengeKind } from './types';

/**
 * Float-comparison slack. Judge aggregates are means of two-decimal scores, so
 * a difference meant to land EXACTLY on the tolerance bar (e.g. 0.90 − 0.87)
 * can come out as 0.0300000000000000266 in IEEE-754. EPS absorbs that so the
 * bar is inclusive as specified ("within tolerance" includes equality) without
 * loosening the rule by any meaningful amount.
 */
const EPS = 1e-9;

export interface ClearanceInput {
  kind: ChallengeKind;
  incumbentScore: number;
  challengerScore: number;
  qualityTolerance: number;
}

export interface ClearanceResult {
  cleared: boolean;
  reason: string;
}

export function decideClearance(input: ClearanceInput): ClearanceResult {
  const { kind, incumbentScore, challengerScore, qualityTolerance } = input;
  const delta = challengerScore - incumbentScore; // ≥0 means as-good-or-better
  const fmt = (n: number) => n.toFixed(3);

  if (kind === 'cost') {
    // Cleared if the challenger is no worse than the incumbent by more than the
    // tolerance band. Equivalent to delta ≥ -tolerance.
    const cleared = incumbentScore - challengerScore <= qualityTolerance + EPS;
    const reason = cleared
      ? `cheaper challenger ${fmt(challengerScore)} is within tolerance ${fmt(qualityTolerance)} of incumbent ${fmt(incumbentScore)} — cost win cleared`
      : `cheaper challenger ${fmt(challengerScore)} falls ${fmt(-delta)} below incumbent ${fmt(incumbentScore)} (> tolerance ${fmt(qualityTolerance)}) — not cleared`;
    return { cleared, reason };
  }

  // 'quality': must be at least as good as the incumbent.
  const cleared = challengerScore - incumbentScore >= -EPS;
  const reason = cleared
    ? `quality challenger ${fmt(challengerScore)} ≥ incumbent ${fmt(incumbentScore)} — headroom cleared`
    : `quality challenger ${fmt(challengerScore)} < incumbent ${fmt(incumbentScore)} — not cleared`;
  return { cleared, reason };
}
