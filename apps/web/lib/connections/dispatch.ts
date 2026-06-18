import 'server-only';
import type { NibbinRef, RunTrigger, RunOutcome } from '@nibbin/runtime';

export interface ConnectorEvent {
  provider: string;
  connectionId: string;
  accountId: string;
  kind: string;
  historyId?: string;
  dedupeKey: string;
}

export interface DispatchDeps {
  activeNibbinsForAccount: (accountId: string) => Promise<NibbinRef[]>;
  triggerRun: (nibbinId: string, trigger: RunTrigger) => Promise<RunOutcome>;
  fanOutCeiling?: number;
  /**
   * Optional read-only check (issue #113): has this (event, Nibbin) already been
   * dispatched in a prior cycle? Consulted BEFORE `triggerRun` so an already-
   * fired Nibbin is skipped at the dispatch layer on a capped re-poll — instead
   * of re-invoking `triggerRun` every cycle and leaning on the runtime admission
   * debounce (≈ the poll interval, not guaranteed ≥ it) to suppress model
   * re-spend. It MUST be read-only: the first-fire claim is still committed only
   * after a successful `triggerRun` (via `recordOnce`), so a failed run is
   * retried, not swallowed (P2.5). Key: `${event.dedupeKey}:${nibbin.id}`.
   */
  alreadyDispatched?: (key: string) => Promise<boolean>;
  /**
   * Optional per-(event, Nibbin) deduplication guard. When provided,
   * `dispatchForConnection` calls it before firing each Nibbin; if it returns
   * false the Nibbin is skipped (already dispatched in a prior cycle).
   * The key passed is `${event.dedupeKey}:${nibbin.id}`.
   */
  recordOnce?: (key: string) => Promise<boolean>;
}

export interface DispatchResult {
  triggered: number;
  capped: boolean;
  /** Number of eligible Nibbins that were deferred due to the fan-out ceiling. 0 when not capped. */
  deferred: number;
}

const FAN_OUT_CEILING = 5;

export async function dispatchForConnection(
  event: ConnectorEvent,
  deps: DispatchDeps,
): Promise<DispatchResult> {
  const ceiling = deps.fanOutCeiling ?? FAN_OUT_CEILING;
  const source = `connector:${event.provider}:${event.kind}`;
  const nibbins = await deps.activeNibbinsForAccount(event.accountId);

  // Collect all eligible Nibbins (stage/status/source). recordOnce is NOT
  // consumed here — it is checked/committed only immediately before a Nibbin
  // is actually triggered, so deferred Nibbins (beyond the ceiling) keep their
  // first-fire claim for the next cycle.
  const eligibleAll = nibbins.filter(
    (n) =>
      n.stage !== 'egg' &&
      n.status === 'active' &&
      n.spec.triggers.some((t) => t.kind === 'event' && t.source === source),
  );

  // Merge eligibility + trigger into one pass. We must not consume a recordOnce
  // key (which is the per-(event, Nibbin) first-fire claim) for a Nibbin we do
  // not actually trigger this cycle:
  //
  //  P2.4 — once we reach the ceiling, the remaining eligible Nibbins are
  //  DEFERRED. We count them WITHOUT touching recordOnce, so on the next
  //  (cursor-not-advanced) cycle they are still "first" and fire then.
  //
  //  P2.5 — claim-then-commit. We never record the recordOnce key BEFORE the
  //  run is kicked off: triggerRun runs first, and only on success do we commit
  //  the key. So a thrown/failed triggerRun leaves the key unrecorded, and the
  //  next cycle still treats the Nibbin as "first" and retries it instead of
  //  permanently swallowing the trigger. triggerRun is idempotent on dedupeKey,
  //  so re-firing a Nibbin already recorded in a prior cycle is absorbed at the
  //  run layer (recordOnce returning false just means we don't double-count it).
  let triggered = 0;
  let deferred = 0;
  for (const nibbin of eligibleAll) {
    const claimKey = `${event.dedupeKey}:${nibbin.id}`;

    //  P3.4 (#113) — skip already-fired Nibbins BEFORE consuming a ceiling slot
    //  or calling triggerRun. On a capped re-poll the cursor stays parked and
    //  this same event re-dispatches every cycle; without this guard each
    //  already-fired Nibbin re-enters triggerRun and only the runtime admission
    //  debounce (not guaranteed >= the poll interval) prevents model re-spend.
    //  The check is read-only — the claim is still committed only after a
    //  successful triggerRun below, so P2.5 (failed run is retried) holds. When
    //  the dep is absent, behaviour is unchanged: the post-trigger recordOnce
    //  still dedupes the count, just one cycle later.
    if (deps.alreadyDispatched && (await deps.alreadyDispatched(claimKey))) {
      continue;
    }

    if (triggered >= ceiling) {
      // Beyond the ceiling: defer WITHOUT consuming recordOnce.
      deferred++;
      continue;
    }
    // triggerRun is idempotent on dedupeKey; a throw propagates (caller leaves
    // its cursor unadvanced) so the trigger is retried, not swallowed.
    await deps.triggerRun(nibbin.id, { kind: 'event', key: source, dedupeKey: event.dedupeKey });
    // Commit the first-fire claim only after the run was successfully started.
    if (deps.recordOnce) {
      const isFirst = await deps.recordOnce(claimKey);
      if (!isFirst) continue; // already dispatched in a prior cycle — don't count
    }
    triggered++;
  }

  const capped = deferred > 0;
  return { triggered, capped, deferred };
}
