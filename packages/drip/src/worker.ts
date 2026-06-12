/**
 * The drip worker tick. No dev server — this runs as a worker (cron/daemon)
 * and is safe to run as often as you like:
 *
 *  - the store's claimSend is the double-send guard (DB unique indexes, not
 *    application reads), so two overlapping ticks cannot push twice;
 *  - beats are planned per-arc in the user's timezone with quiet hours and
 *    the one-push-per-day + 20h spacing rules (scheduler.ts);
 *  - earned events (evolution/graduation) become in-product notifications
 *    whenever they arrive — they never count against the daily push and are
 *    idempotent on event id.
 *
 * The email mirror is optional per arc and the email port owns suppression
 * and warm-up — a withheld email does NOT fail the beat (the in-product leaf
 * is the primary surface).
 */
import { buildBeatContent } from './content';
import { localDay, safeTz } from './localtime';
import { planBeat } from './scheduler';
import type { ArcDataPort, ArcRow, Clock, DripStore, EmailPort } from './types';

export interface WorkerDeps {
  store: DripStore;
  data: ArcDataPort;
  email: EmailPort;
  clock: Clock;
  /** Report, never throw — one broken arc must not stall the rest. */
  onError?: (accountId: string, err: unknown) => void;
}

export interface TickResult {
  arcs: number;
  pushed: number;
  skipped: number;
  completed: number;
  earnedNotifications: number;
  errors: number;
}

export async function tick(deps: WorkerDeps): Promise<TickResult> {
  const result: TickResult = { arcs: 0, pushed: 0, skipped: 0, completed: 0, earnedNotifications: 0, errors: 0 };
  const arcs = await deps.store.activeArcs();
  result.arcs = arcs.length;

  for (const arc of arcs) {
    try {
      await tickArc(deps, arc, result);
    } catch (err) {
      result.errors += 1;
      deps.onError?.(arc.accountId, err);
    }
  }
  return result;
}

async function tickArc(deps: WorkerDeps, arc: ArcRow, result: TickResult): Promise<void> {
  const now = deps.clock();
  const tz = safeTz(arc.tz);
  const today = localDay(now, tz);

  // Earned events first — they fire whenever earned, independent of the table.
  const events = await deps.data.earnedEvents(arc.accountId);
  for (const event of events) {
    await deps.store.insertEarnedNotification(arc.accountId, event);
    result.earnedNotifications += 1;
  }

  const flags = await deps.data.flags(arc.accountId);
  const plan = planBeat(arc, flags, now);

  if (plan.skip.length > 0) {
    await deps.store.recordSkipped(arc.accountId, plan.skip, today);
    result.skipped += plan.skip.length;
  }

  if (plan.send) {
    // Claim before building anything: the claim is the atomic gate.
    const claimed = await deps.store.claimSend(arc.accountId, plan.send, today);
    if (claimed) {
      try {
        const content = await buildBeatContent(plan.send, {
          accountId: arc.accountId,
          today,
          startedAt: arc.startedAt,
          tz,
          flags,
          data: deps.data,
        });
        await deps.store.insertBeatNotification(arc.accountId, content);
        if (arc.emailEnabled && arc.email) {
          // Suppression + warm-up live inside the port; "withheld" is success.
          await deps.email.sendBeat({ accountId: arc.accountId, to: arc.email, beat: plan.send, content });
        }
        await deps.store.markSent(arc.accountId, plan.send);
        result.pushed += 1;
      } catch (err) {
        // The claim row stays — the beat reads as 'failed', and the day's
        // push slot stays used (we'd rather miss a beat than double-push).
        await deps.store.markFailed(arc.accountId, plan.send);
        throw err;
      }
    }
  }

  if (plan.arcComplete) {
    await deps.store.completeArc(arc.accountId);
    result.completed += 1;
  }
}
