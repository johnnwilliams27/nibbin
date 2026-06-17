import 'server-only';
import type { NibbinRef, RunTrigger, AdmissionOutcome } from '@nibbin/runtime';

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
  triggerRun: (nibbinId: string, trigger: RunTrigger) => Promise<AdmissionOutcome>;
  fanOutCeiling?: number;
}

export interface DispatchResult {
  triggered: number;
  capped: boolean;
}

const FAN_OUT_CEILING = 5;

export async function dispatchForConnection(
  event: ConnectorEvent,
  deps: DispatchDeps,
): Promise<DispatchResult> {
  const ceiling = deps.fanOutCeiling ?? FAN_OUT_CEILING;
  const source = `connector:${event.provider}:${event.kind}`;
  const nibbins = await deps.activeNibbinsForAccount(event.accountId);

  let triggered = 0;
  for (const nibbin of nibbins) {
    if (triggered >= ceiling) return { triggered, capped: true };
    if (nibbin.stage === 'egg') continue;
    if (nibbin.status !== 'active') continue;
    const matches = nibbin.spec.triggers.some(
      (t) => t.kind === 'event' && t.source === source,
    );
    if (!matches) continue;
    await deps.triggerRun(nibbin.id, { kind: 'event', key: source, dedupeKey: event.dedupeKey });
    triggered++;
  }
  return { triggered, capped: false };
}
