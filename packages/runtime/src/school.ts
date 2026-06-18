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
 * `decisions` must be newest-first AND already filtered to the current stage
 * (decided after the Nibbin's stage_changed_at) — the promotion window is
 * stage-scoped so each stage is earned fresh and a demotion resets the climb.
 */
export function promotionCheck(
  decisions: readonly Decision[],
  curriculum: CurriculumConfig,
  opts?: {
    /** Per-decision severity weight (1/3/10), parallel to `decisions`. R3. */
    weights?: readonly number[];
    /** Distinct routine patterns approved-unedited in this stage. R1. */
    distinctPatterns?: number;
    /** Current stage — coverage applies only to senior→grad. */
    stage?: StageName;
  },
): PromotionCheck {
  // The floors are invariant: config may tighten, never loosen (§4.7).
  const windowRuns = Math.max(curriculum.promotion.windowRuns, 25);
  const needPct = Math.max(curriculum.promotion.minApprovedUneditedPct, 0.95);
  const coverageK = Math.max(curriculum.promotion.coverageMinPatterns ?? 4, 4);
  const window = decisions.slice(0, windowRuns);
  const approved = window.filter((d) => d === 'approved').length;

  let eligible = window.length >= windowRuns && approved / window.length >= needPct;

  // R3 (additive): must ALSO clear the gate weighted by stakes.
  if (eligible && opts?.weights) {
    const w = opts.weights.slice(0, windowRuns);
    const wTotal = w.reduce((s, x) => s + x, 0);
    const wApproved = window.reduce((s, d, i) => s + (d === 'approved' ? (w[i] ?? 1) : 0), 0);
    if (wTotal > 0 && wApproved / wTotal < needPct) eligible = false;
  }
  // R1 (additive, senior→grad only): breadth across ≥K distinct patterns.
  if (eligible && opts?.stage === 'senior') {
    if ((opts.distinctPatterns ?? 0) < coverageK) eligible = false;
  }

  return {
    eligible,
    decidedInWindow: window.length,
    approvedUnedited: approved,
    windowRuns,
    needPct,
  };
}

/** Side-effect stakes for a capability — the TS mirror of the SQL
 *  `capability_stakes`. Reads are low; destructive highest; everything else
 *  (incl. unknown) is consequential (=3). Used to weight R3 (see promotionCheck). */
export function stakesOf(capability: string | null | undefined): number {
  if (capability == null) return 1; // NULL/undefined → 1; matches SQL ('' falls through to the 3 default)
  if (capability.endsWith('.read')) return 1;
  if (capability.endsWith('.delete') || capability.endsWith('.archive')) return 10;
  return 3;
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
