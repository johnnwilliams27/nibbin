/**
 * Training Mode — SPEC §18.1 ("sampled + time-boxed") layered on Agent School
 * (§4.7). The HARD invariant: Training Mode is STRICTLY ADDITIVE to School. It
 * NEVER loosens a gate.
 *
 * It does exactly one thing: a user opts an agent into a time-boxed,
 * budget-bounded window during which the scheduler is ALLOWED to sample MORE
 * (and/or varied) triggers, so the agent surfaces more drafts-for-approval and
 * accumulates the approval signal School needs for promotion FASTER. Every
 * draft it produces still rides the unchanged runner gates
 * (`gateSideEffect` / write-grant / idempotency, see runner.ts) and promotion
 * still requires the unchanged thresholds (`promotionCheck` / nibbin_promote).
 *
 * Concretely, this module is a SAMPLING/cadence authority, NOT a gate:
 *  - `trainingActive` — is the window still open? (time box + budget).
 *  - `trainingSampleDecision` — should the scheduler launch an EXTRA sampled run
 *    now, and consume one unit of the window's budget? It can only ever say
 *    "sample" within the bounds, and "stop" once expired/over-budget. It cannot
 *    auto-execute, cannot promote, cannot change any School threshold.
 *  - `noveltyVariants` — optionally fan a draft prompt into a couple of bounded
 *    phrasings for the user to pick; the pick is recorded as an ordinary
 *    approval (the existing promotion signal), never a new autonomy grant.
 *
 * There is no path from this file to `gateSideEffect`, `promotionCheck`,
 * `routineMinApprovals`, or the effect executor. That absence is the proof.
 */
import type { StageName } from './types';

/**
 * An opt-in training window for ONE agent. Immutable once created (a renewal is
 * a new window). Mirrors the `training_sessions` row. All bounds are REQUIRED —
 * a window with no time box or no budget cannot exist.
 */
export interface TrainingWindow {
  id: string;
  accountId: string;
  nibbinId: string;
  /** epoch ms — the window opened. */
  startedAtMs: number;
  /** epoch ms — the HARD time box; the window is dead at/after this instant. */
  expiresAtMs: number;
  /** max EXTRA sampled runs this window may launch. Hard budget cap. */
  maxRuns: number;
  /** extra sampled runs launched so far (≤ maxRuns). */
  runsUsed: number;
  /**
   * Whether to offer bounded novelty variations for the user to pick during the
   * window (still a draft-for-approval; never an extra autonomy path).
   */
  novelty: boolean;
  /** set when the user ends it early, or the auto-expiry sweep closes it. */
  endedAtMs?: number;
  endedReason?: 'expired' | 'budget' | 'user' | 'promoted';
}

/** The two hard bounds, named for the caller's explanation strings. */
export type TrainingBound = 'time_box' | 'budget';

/**
 * Is this window still open for sampling AS OF `nowMs`? A window is active only
 * while it is unended, before its time box, and under its run budget. This is
 * the single predicate the auto-expiry sweep and the sampler both consult.
 */
export function trainingActive(w: TrainingWindow, nowMs: number): boolean {
  if (w.endedAtMs !== undefined) return false;
  if (nowMs >= w.expiresAtMs) return false;
  if (w.runsUsed >= w.maxRuns) return false;
  return true;
}

/**
 * Which bound (if any) has closed the window as of `nowMs`. `null` = still open.
 * Time box is reported first so an expired window reads as 'time_box' even if it
 * also happens to be at budget.
 */
export function trainingClosedBy(w: TrainingWindow, nowMs: number): TrainingBound | null {
  if (w.endedAtMs !== undefined) return w.endedReason === 'budget' ? 'budget' : 'time_box';
  if (nowMs >= w.expiresAtMs) return 'time_box';
  if (w.runsUsed >= w.maxRuns) return 'budget';
  return null;
}

export type SampleDecision =
  | { sample: true; runsRemaining: number }
  | { sample: false; reason: 'inactive' | TrainingBound };

/**
 * Should the scheduler launch ONE extra sampled run for this agent now? This is
 * the entire authority Training Mode adds to scheduling: it gates SAMPLING, and
 * NOTHING else. A `sample: true` means "you may admit one more supervised run
 * inside the window" — that run then goes through `executeRun` exactly like any
 * other (same budget pre-check, same ceilings, same School gate). It can only
 * ever return true while the window is active; it never returns "execute".
 *
 * Eggs are observe-only (§4.7): they produce no output, so there is nothing to
 * sample — a training window over an egg never samples (the egg gate in
 * executeRun would refuse output regardless; we short-circuit so we don't even
 * spend a budget unit).
 */
export function trainingSampleDecision(
  w: TrainingWindow,
  stage: StageName,
  nowMs: number,
): SampleDecision {
  const closed = trainingClosedBy(w, nowMs);
  if (closed !== null) return { sample: false, reason: closed };
  if (!trainingActive(w, nowMs)) return { sample: false, reason: 'inactive' };
  // Eggs draft nothing — accelerating their cadence would only burn budget on
  // runs the School gate denies. Training waits until they're a Student.
  if (stage === 'egg') return { sample: false, reason: 'inactive' };
  return { sample: true, runsRemaining: w.maxRuns - w.runsUsed - 1 };
}

/**
 * Apply one consumed sample to the window, returning the next immutable window
 * state (runsUsed + 1, auto-closing if that hit the budget). Pure: the store
 * persists the result; nothing here touches credits or gates. Throws if the
 * window is already closed (callers must `trainingSampleDecision` first).
 */
export function consumeSample(w: TrainingWindow, nowMs: number): TrainingWindow {
  if (!trainingActive(w, nowMs)) throw new Error('cannot consume a closed training window');
  const runsUsed = w.runsUsed + 1;
  const atBudget = runsUsed >= w.maxRuns;
  return {
    ...w,
    runsUsed,
    ...(atBudget ? { endedAtMs: nowMs, endedReason: 'budget' as const } : {}),
  };
}

/** Bounded fan-out of novelty phrasings. The caller passes the deterministic
 *  base draft + any model-generated alternates; we cap the count so a window
 *  can never explode the per-run work, and we always keep the base first so a
 *  user picking "as written" is the no-novelty path. Returns the base unchanged
 *  when novelty is off or no alternates exist. NEVER fabricates content. */
export const MAX_NOVELTY_VARIANTS = 3;

export function noveltyVariants(
  w: TrainingWindow,
  base: string,
  alternates: readonly string[],
): string[] {
  if (!w.novelty || alternates.length === 0) return [base];
  const out = [base];
  for (const a of alternates) {
    if (out.length >= MAX_NOVELTY_VARIANTS) break;
    const t = a.trim();
    if (t.length > 0 && !out.includes(t)) out.push(t);
  }
  return out;
}

/* ── Store seam ───────────────────────────────────────────────────────────── */

export interface OpenTrainingRequest {
  accountId: string;
  nibbinId: string;
  /** window length; clamped to [MIN_WINDOW_MS, MAX_WINDOW_MS] by the store. */
  durationMs: number;
  /** extra-run budget; clamped to [1, MAX_TRAINING_RUNS]. */
  maxRuns: number;
  novelty: boolean;
}

/** Conservative bounds the store enforces so no caller can open an unbounded
 *  window. A window is at most 14 days and at most 100 extra runs — generous
 *  enough to accelerate the 25-run promotion window a few times over, never a
 *  perpetual cost. */
export const MIN_WINDOW_MS = 60 * 60 * 1000; // 1 hour
export const MAX_WINDOW_MS = 14 * 24 * 60 * 60 * 1000; // 14 days
export const MAX_TRAINING_RUNS = 100;

export function clampWindow(req: OpenTrainingRequest): { durationMs: number; maxRuns: number } {
  return {
    durationMs: Math.min(Math.max(req.durationMs, MIN_WINDOW_MS), MAX_WINDOW_MS),
    maxRuns: Math.min(Math.max(Math.floor(req.maxRuns), 1), MAX_TRAINING_RUNS),
  };
}

export interface TrainingStore {
  /**
   * The single OPEN window for this agent as of now, or null. "Open" = active
   * (unended + before time box + under budget). Account-scoped: an
   * implementation MUST scope by accountId so one account's window can never be
   * read or sampled against another account's agent.
   */
  active(accountId: string, nibbinId: string, nowMs: number): Promise<TrainingWindow | null>;
  /** Opt an agent in. One open window per agent — opening again is idempotent
   *  (returns the existing open window). Bounds are clamped (clampWindow). */
  open(req: OpenTrainingRequest, nowMs: number): Promise<TrainingWindow>;
  /** Persist a consumed-sample step (runsUsed++/auto-close). */
  recordSample(window: TrainingWindow, nowMs: number): Promise<TrainingWindow>;
  /** End the open window early (user opt-out, or auto-expiry sweep). No-op if
   *  already closed. */
  close(accountId: string, nibbinId: string, reason: TrainingWindow['endedReason'], nowMs: number): Promise<void>;
}

/* ── In-memory implementation (tests, harnesses) ──────────────────────────── */

export class MemoryTrainingStore implements TrainingStore {
  private readonly windows: TrainingWindow[] = [];
  private seq = 0;

  /** Test helper: all windows (open + closed) for assertions. */
  all(): readonly TrainingWindow[] {
    return this.windows;
  }

  private openRow(accountId: string, nibbinId: string, nowMs: number): TrainingWindow | undefined {
    return this.windows.find(
      (w) => w.accountId === accountId && w.nibbinId === nibbinId && trainingActive(w, nowMs),
    );
  }

  async active(accountId: string, nibbinId: string, nowMs: number): Promise<TrainingWindow | null> {
    return this.openRow(accountId, nibbinId, nowMs) ?? null;
  }

  async open(req: OpenTrainingRequest, nowMs: number): Promise<TrainingWindow> {
    const existing = this.openRow(req.accountId, req.nibbinId, nowMs);
    if (existing) return existing;
    const { durationMs, maxRuns } = clampWindow(req);
    const w: TrainingWindow = {
      id: `train-${++this.seq}`,
      accountId: req.accountId,
      nibbinId: req.nibbinId,
      startedAtMs: nowMs,
      expiresAtMs: nowMs + durationMs,
      maxRuns,
      runsUsed: 0,
      novelty: req.novelty,
    };
    this.windows.push(w);
    return w;
  }

  async recordSample(window: TrainingWindow, nowMs: number): Promise<TrainingWindow> {
    const idx = this.windows.findIndex((w) => w.id === window.id);
    if (idx < 0) throw new Error(`unknown training window ${window.id}`);
    const next = consumeSample(this.windows[idx], nowMs);
    this.windows[idx] = next;
    return next;
  }

  async close(
    accountId: string,
    nibbinId: string,
    reason: TrainingWindow['endedReason'],
    nowMs: number,
  ): Promise<void> {
    const w = this.openRow(accountId, nibbinId, nowMs);
    if (!w) return;
    w.endedAtMs = nowMs;
    w.endedReason = reason;
  }
}
