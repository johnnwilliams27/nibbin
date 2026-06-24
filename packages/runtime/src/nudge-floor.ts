/**
 * Re-nudge cadence / safety floor (Connector batch Task 5a).
 *
 * The overdue-invoice Nibbin (PR #237) emails a customer about a still-overdue
 * Stripe invoice. Nothing in the existing safety stack bounds a re-nudge ACROSS
 * runs: the §18.3 resource-claim only stops two SIMULTANEOUS runs (it releases
 * at run-end), and schedule triggers carry no dedupeKey, so the effect
 * idempotency key falls back to `runId` per run. A still-overdue invoice would
 * therefore be re-nudged on every scheduled tick — spamming the customer.
 *
 * This module is the SOLE decision: given the prior nudge history for a
 * (nibbin, resource), should this send proceed? It is split into two layers,
 * per the owner's 2026-06-22 direction ("do NOT hardcode a cooldown constant —
 * separate the safety floor from a learned/derived cadence"):
 *
 *  1. SAFETY FLOOR (a runtime invariant, NOT configurable away). A hard cap that
 *     a wrong-but-confident learner can never breach:
 *       - never more than FLOOR_MAX_NUDGES total for one resource, and
 *       - never twice inside FLOOR_MIN_INTERVAL_MS.
 *     Same category as the send-velocity cap. The owner can make the policy MORE
 *     conservative but never LESS (values below the floor clamp UP to the floor).
 *
 *  2. OBSERVED / OWNER CADENCE (within the floor). The owner's actual follow-up
 *     behavior — a business rule ("weekly until paid, stop after 3") or, absent
 *     one, the learned cadence from the field study / reinforcement loop — sets
 *     the interval BETWEEN nudges and the max count, as long as both stay at or
 *     beyond the floor. The nudge history IS the self-observation source (the
 *     ledger of what this Nibbin already did), not a fresh Stripe read.
 *
 * Stripe-reminder COORDINATION (avoid double-dunning when Stripe's own automatic
 * reminders are on) is enforced UPSTREAM in the primitive — it reads the
 * read-only invoice's dunning signals and degrades to a compose note instead of
 * drafting — because that decision needs the invoice fields, which only the
 * primitive holds. This module is the cross-run accounting wall.
 */

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/**
 * The hard floor. These are deliberately conservative — they exist to stop a
 * runaway, not to be the everyday cadence (the owner/learned cadence is almost
 * always slower). Changing these is a safety-invariant change.
 */
export const FLOOR_MIN_INTERVAL_MS = 3 * DAY; // never re-nudge the same invoice within 3 days
export const FLOOR_MAX_NUDGES = 4;            // never nudge the same invoice more than 4 times within the lookback window

/**
 * The default cadence WHEN the owner has set no business rule and no learned
 * cadence is available yet. Chosen to sit at/above the floor so a brand-new
 * Nibbin behaves sensibly before it has observed anything: weekly, up to 3.
 */
export const DEFAULT_CADENCE_INTERVAL_MS = 7 * DAY;
export const DEFAULT_CADENCE_MAX_NUDGES = 3;

/**
 * How far back the count gate looks. The max-count cap is therefore a ROLLING
 * 180-day cap, not a literal lifetime cap: a genuinely long-lived overdue
 * invoice (left `open` > 180 days) could accrue up to FLOOR_MAX_NUDGES more
 * nudges in the next window. That is an accepted, tiny residual (≤4 emails per
 * 180 days for a never-paid invoice), and 180 days comfortably exceeds the
 * primitive's 90-day overdue-invoice read window so a normally-aged invoice's
 * full nudge history is always in scope.
 */
export const NUDGE_LOOKBACK_MS = 180 * DAY;

/**
 * The effective policy for one (nibbin, resource). `intervalMs`/`maxNudges` come
 * from the owner business rule or the learned cadence; both are CLAMPED to the
 * floor so the policy can only be at-or-stricter than the safety wall.
 */
export interface NudgeCadencePolicy {
  /** Minimum ms between nudges. Clamped up to FLOOR_MIN_INTERVAL_MS. */
  intervalMs: number;
  /** Max nudges for one resource within the lookback window. Clamped down to FLOOR_MAX_NUDGES. */
  maxNudges: number;
}

/** Build a clamped policy from owner/learned inputs (any field optional). */
export function resolveCadencePolicy(input?: Partial<NudgeCadencePolicy>): NudgeCadencePolicy {
  // Coerce non-finite input (NaN/Infinity) to the default BEFORE clamping.
  // `typeof NaN === 'number'` slips past deriveNudgeFloor's type guard, and
  // `Math.max(FLOOR, NaN) === NaN` / `Math.min(CAP, NaN) === NaN` would silently
  // DISABLE the gate it feeds (`x < NaN` and `x >= NaN` are both false) — a
  // crafted `nudgeCadence: { maxNudges: NaN }` would otherwise defeat the hard
  // count cap. Coercing to the default keeps the floor un-bypassable (red-team P2-1).
  const rawInterval = Number.isFinite(input?.intervalMs) ? (input!.intervalMs as number) : DEFAULT_CADENCE_INTERVAL_MS;
  const rawMax = Number.isFinite(input?.maxNudges) ? (input!.maxNudges as number) : DEFAULT_CADENCE_MAX_NUDGES;
  const intervalMs = Math.max(FLOOR_MIN_INTERVAL_MS, rawInterval);
  const maxNudges = Math.min(FLOOR_MAX_NUDGES, Math.max(1, rawMax));
  return { intervalMs, maxNudges };
}

export type NudgeDecision =
  | { allow: true }
  | { allow: false; reason: 'max_count' | 'too_soon'; floor: boolean };

/**
 * Decide whether a nudge to a (nibbin, resource) may proceed NOW, given the
 * prior nudge timestamps (Unix ms, any order) and the effective policy.
 *
 *  - `max_count`  : the resource has already been nudged `maxNudges` times.
 *  - `too_soon`   : the last nudge is more recent than `intervalMs` ago.
 *  - `floor:true` : the block is the HARD safety floor (not just the soft
 *                   owner/learned cadence) — surfaced so the skip step can say so.
 *
 * Evaluated against BOTH the clamped policy and the raw floor; the floor flag is
 * set when the floor alone would also have blocked it.
 */
export function decideNudge(
  history: number[],
  nowMs: number,
  policy: NudgeCadencePolicy,
): NudgeDecision {
  const count = history.length;
  const last = history.length > 0 ? Math.max(...history) : null;

  // Max-count gate (policy is already clamped to ≤ FLOOR_MAX_NUDGES).
  if (count >= policy.maxNudges) {
    return { allow: false, reason: 'max_count', floor: count >= FLOOR_MAX_NUDGES };
  }

  // Interval gate. `last === null` (never nudged) always passes.
  if (last !== null) {
    const sinceLast = nowMs - last;
    if (sinceLast < policy.intervalMs) {
      return { allow: false, reason: 'too_soon', floor: sinceLast < FLOOR_MIN_INTERVAL_MS };
    }
  }

  return { allow: true };
}
