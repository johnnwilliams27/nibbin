import { describe, it, expect, vi } from 'vitest';
import { dispatchForConnection, type ConnectorEvent } from './dispatch';
import { MemoryWebhookEventStore } from '@nibbin/connectors';
import type { NibbinRef } from '@nibbin/runtime';

function makeNibbin(id = 'nib-1'): NibbinRef {
  return {
    id,
    accountId: 'acct-1',
    name: 'Scribe',
    stage: 'student',
    stageChangedAt: 0,
    status: 'active',
    spec: {
      templateKey: 'scribe', version: 1, displayName: 'Scribe',
      toolsAllowlist: ['email.read'], requiredConnectors: ['gmail'],
      triggers: [{ kind: 'event', source: 'connector:gmail:message.received', debounceSecs: 300 }],
      curriculum: { measures: '', promotion: { windowRuns: 25, minApprovedUneditedPct: 0.95 }, routineMinApprovals: 5 },
      creditProfile: { weightClass: 'standard', ceilings: { maxSteps: 20, maxTokens: 4000, maxWallClockMs: 30000 } },
    },
  };
}

describe('idempotency across cron runs', () => {
  it('MemoryWebhookEventStore absorbs replay — second recordOnce returns false', async () => {
    const store = new MemoryWebhookEventStore();
    const first = await store.recordOnce('gmail', 'gmail:conn-1:msg-1');
    const second = await store.recordOnce('gmail', 'gmail:conn-1:msg-1');
    expect(first).toBe(true);
    expect(second).toBe(false);
  });

  it('simulate missed push: cursor not advanced → second cron poll re-dispatches via same dedupeKey is absorbed', async () => {
    const store = new MemoryWebhookEventStore();
    const triggerRun = vi.fn().mockResolvedValue({ kind: 'not_started', why: 'deduped' });
    const event: ConnectorEvent = {
      provider: 'gmail', connectionId: 'conn-1', accountId: 'acct-1',
      kind: 'message.received', dedupeKey: 'gmail:conn-1:msg-1',
    };

    // First poll — isFirst = true, dispatch runs
    const first = await store.recordOnce('gmail', event.dedupeKey);
    if (first) {
      await dispatchForConnection(event, {
        activeNibbinsForAccount: async () => [makeNibbin()],
        triggerRun,
      });
    }
    expect(triggerRun).toHaveBeenCalledOnce();

    // Second poll (simulated push miss, cursor not advanced) — replay, absorbed
    const second = await store.recordOnce('gmail', event.dedupeKey);
    expect(second).toBe(false);
    // triggerRun not called again — layer 1 absorbed it
    expect(triggerRun).toHaveBeenCalledOnce();
  });
});
