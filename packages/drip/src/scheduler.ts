/**
 * Pure beat scheduler. Decides, for one arc at one instant, the single beat
 * (if any) that should go out — and which missed beats to retire quietly.
 *
 * Rules (SPEC §4.5): max one push per local day; quiet hours respected;
 * nothing decays, nothing nags — a missed day is skipped, never piled onto
 * tomorrow; the only beat that ever catches up is the most recent one due.
 */
import { ARC_LENGTH_DAYS, BEATS, inQuietHours } from './beats';
import { arcDay, localDay, localHour, safeTz } from './localtime';
import type { ArcFlags, ArcState, BeatDef, BeatKey, BeatPlan } from './types';

/**
 * Absolute floor between two pushes. The one-push-per-day rule is keyed to
 * the user's LOCAL day, and users.tz is user-editable — flipping timezone
 * rolls the day label and would otherwise allow a second push hours after
 * the first (the same class of bug as the router budget GOTCHA). 20h of
 * wall-clock spacing makes that impossible while still letting an evening
 * beat follow a previous morning beat.
 */
export const MIN_PUSH_SPACING_MS = 20 * 60 * 60 * 1000;

/** Beats may run this many days late before the arc closes the door. */
export const CATCH_UP_GRACE_DAYS = 2;

/** The key actually delivered for a slot, given today's flags. */
function effectiveKey(def: BeatDef, flags: ArcFlags): BeatKey | null {
  if (def.requires === 'study' && !flags.studyActive) return def.substitute ?? null;
  if (def.requires === 'near_graduation' && !flags.nearGraduation) return null;
  return def.key;
}

/** A slot is resolved once any of its possible keys has a send record. */
function slotResolved(def: BeatDef, recorded: ReadonlySet<BeatKey>): boolean {
  if (recorded.has(def.key)) return true;
  return def.substitute != null && recorded.has(def.substitute);
}

export function planBeat(arc: ArcState, flags: ArcFlags, now: Date): BeatPlan {
  const tz = safeTz(arc.tz);
  const day = arcDay(arc.startedAt, now, tz);
  const none: BeatPlan = { send: null, skip: [], arcComplete: false };
  if (day < 1) return none; // day 0 is onboarding (§4.1), never a push

  const recorded = new Set<BeatKey>(arc.sends.map((s) => s.beat));
  const open = BEATS.filter((b) => b.day <= day && !slotResolved(b, recorded));

  if (day > ARC_LENGTH_DAYS + CATCH_UP_GRACE_DAYS) {
    // The fortnight is over: retire whatever never fired and close the arc.
    return {
      send: null,
      skip: open.map((b) => effectiveKey(b, flags) ?? b.key),
      arcComplete: true,
    };
  }

  if (open.length === 0) {
    return { send: null, skip: [], arcComplete: day > ARC_LENGTH_DAYS };
  }

  // The most recent slot is the only candidate; older misses retire quietly.
  const candidate = open[open.length - 1];
  const skip: BeatKey[] = [];
  for (const b of open.slice(0, -1)) {
    skip.push(effectiveKey(b, flags) ?? b.key);
  }

  let send: BeatKey | null = effectiveKey(candidate, flags);

  // Conditional slot, condition not (yet) met: hold on its own day — School
  // progress later today can still earn it — and retire it once the day passes.
  if (send === null) {
    if (candidate.day < day) skip.push(candidate.key);
    return { send: null, skip, arcComplete: false };
  }

  const hour = localHour(now, tz);
  const today = localDay(now, tz);

  // Delivery gates — all four must clear or the beat just waits.
  if (hour < candidate.earliestHour) send = null;
  else if (inQuietHours(hour, arc.quiet)) send = null;
  else if (arc.sends.some((s) => s.status !== 'skipped' && s.localDay === today)) send = null;
  else {
    const lastPush = arc.sends
      .filter((s) => s.status !== 'skipped' && s.claimedAt != null)
      .map((s) => (s.claimedAt as Date).getTime())
      .reduce((a, b) => Math.max(a, b), 0);
    if (lastPush > 0 && now.getTime() - lastPush < MIN_PUSH_SPACING_MS) send = null;
  }

  return { send, skip, arcComplete: false };
}
