/**
 * Agent School trust mechanics — SPEC §4.7, enforced at the RUNTIME layer,
 * never the prompt layer (§6.2; docs/INVARIANTS.md).
 *
 * Egg observes (no output) → Student drafts everything → Senior is autonomous
 * only on routine patterns repeatedly matched, flags novelty → Graduate is
 * autonomous within spec, every run logged, exceptions raised as questions.
 *
 * Promotion is verified accuracy over a rolling window — never time served,
 * and no badge, streak, or mechanic may grant or accelerate autonomy.
 * Demotion is one click, instant, dignified.
 */
import type { CurriculumConfig, StageName } from './types';

/* ── Side-effect gating ───────────────────────────────────────────────────── */

export type GateDecision =
  | { action: 'execute' }
  | { action: 'draft'; reason: 'stage' | 'novelty' }
  | { action: 'deny'; reason: 'egg' };

/**
 * The one place draft-vs-execute is decided. `routineApprovals` is how many
 * approved-unedited runs of this exact pattern exist (RoutineStore).
 */
export function gateSideEffect(
  stage: StageName,
  routineApprovals: number,
  curriculum: CurriculumConfig,
): GateDecision {
  switch (stage) {
    case 'egg':
      // Eggs observe; they produce no output at all (§4.7).
      return { action: 'deny', reason: 'egg' };
    case 'student':
      return { action: 'draft', reason: 'stage' };
    case 'senior':
      return routineApprovals >= curriculum.routineMinApprovals
        ? { action: 'execute' }
        : { action: 'draft', reason: 'novelty' };
    case 'grad':
      return { action: 'execute' };
  }
}

/* ── Promotion (≥95% approved-unedited over a rolling 25-run window) ──────── */

export type Decision = 'approved' | 'edited' | 'rejected';

export interface PromotionCheck {
  eligible: boolean;
  decidedInWindow: number;
  approvedUnedited: number;
  windowRuns: number;
  needPct: number;
}

/**
 * Pure mirror of the nibbin_promote SQL check (the SQL is authoritative —
 * this drives UI progress display and the runtime's "should I even ask").
 * `decisions` must be newest-first.
 */
export function promotionCheck(decisions: readonly Decision[], curriculum: CurriculumConfig): PromotionCheck {
  // The floors are invariant: config may tighten, never loosen (§4.7).
  const windowRuns = Math.max(curriculum.promotion.windowRuns, 25);
  const needPct = Math.max(curriculum.promotion.minApprovedUneditedPct, 0.95);
  const window = decisions.slice(0, windowRuns);
  const approved = window.filter((d) => d === 'approved').length;
  return {
    eligible: window.length >= windowRuns && approved / window.length >= needPct,
    decidedInWindow: window.length,
    approvedUnedited: approved,
    windowRuns,
    needPct,
  };
}

export function nextStage(stage: StageName): StageName | null {
  switch (stage) {
    case 'egg': return 'student';
    case 'student': return 'senior';
    case 'senior': return 'grad';
    case 'grad': return null;
  }
}

/** Demotion floor is Student — the egg is pre-output, not a grade. */
export function demotedStage(stage: StageName): StageName | null {
  switch (stage) {
    case 'grad': return 'senior';
    case 'senior': return 'student';
    default: return null;
  }
}
