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

  // Collect all eligible Nibbins first so we can compute the deferred count.
  // When a per-(event, Nibbin) recordOnce is provided, filter out those already
  // dispatched — they were handled in a previous cycle under the ceiling.
  const eligibleAll = nibbins.filter(
    (n) =>
      n.stage !== 'egg' &&
      n.status === 'active' &&
      n.spec.triggers.some((t) => t.kind === 'event' && t.source === source),
  );

  // Resolve which eligible Nibbins haven't been dispatched yet this delta.
  const eligible: NibbinRef[] = [];
  for (const nibbin of eligibleAll) {
    if (deps.recordOnce) {
      const isFirst = await deps.recordOnce(`${event.dedupeKey}:${nibbin.id}`);
      if (!isFirst) continue; // already dispatched in a prior cycle — skip
    }
    eligible.push(nibbin);
  }

  let triggered = 0;
  for (const nibbin of eligible) {
    if (triggered >= ceiling) break;
    await deps.triggerRun(nibbin.id, { kind: 'event', key: source, dedupeKey: event.dedupeKey });
    triggered++;
  }

  const capped = eligible.length > ceiling;
  const deferred = capped ? eligible.length - triggered : 0;
  return { triggered, capped, deferred };
}
