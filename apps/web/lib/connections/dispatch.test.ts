import { describe, it, expect, vi } from 'vitest';
import { dispatchForConnection, type ConnectorEvent } from './dispatch';
import type { NibbinRef, RunOutcome } from '@nibbin/runtime';

function makeNibbin(overrides: Partial<NibbinRef> = {}): NibbinRef {
  return {
    id: 'nib-1',
    accountId: 'acct-1',
    name: 'Scribe',
    stage: 'student',
    status: 'active',
    spec: {
      templateKey: 'scribe',
      version: 1,
      displayName: 'Scribe',
      toolsAllowlist: ['email.read', 'email.draft'],
      requiredConnectors: ['gmail'],
      triggers: [{ kind: 'event', source: 'connector:gmail:message.received', debounceSecs: 300 }],
      curriculum: { measures: '', promotion: { windowRuns: 25, minApprovedUneditedPct: 0.95 }, routineMinApprovals: 5 },
      creditProfile: { weightClass: 'standard', ceilings: { maxSteps: 20, maxTokens: 4000, maxWallClockMs: 30000 } },
    },
    ...overrides,
  };
}

const gmailEvent: ConnectorEvent = {
  provider: 'gmail',
  connectionId: 'conn-1',
  accountId: 'acct-1',
  kind: 'message.received',
  dedupeKey: 'gmail:conn-1:msg-abc',
};

const runOutcome: RunOutcome = { kind: 'not_started', why: 'deduped' };


describe('dispatchForConnection', () => {
  it('calls triggerRun for a Nibbin whose trigger source matches the event', async () => {
    const triggerRun = vi.fn().mockResolvedValue(runOutcome);
    const result = await dispatchForConnection(gmailEvent, {
      activeNibbinsForAccount: async () => [makeNibbin()],
      triggerRun,
    });
    expect(triggerRun).toHaveBeenCalledOnce();
    expect(triggerRun).toHaveBeenCalledWith('nib-1', {
      kind: 'event',
      key: 'connector:gmail:message.received',
      dedupeKey: 'gmail:conn-1:msg-abc',
    });
    expect(result.triggered).toBe(1);
    expect(result.capped).toBe(false);
  });

  it('does NOT trigger a Nibbin with a non-matching event source', async () => {
    const triggerRun = vi.fn();
    const calendarNibbin = makeNibbin({
      spec: {
        ...makeNibbin().spec,
        triggers: [{ kind: 'event', source: 'connector:google-calendar:event.created' }],
      },
    });
    await dispatchForConnection(gmailEvent, {
      activeNibbinsForAccount: async () => [calendarNibbin],
      triggerRun,
    });
    expect(triggerRun).not.toHaveBeenCalled();
  });

  it('does NOT trigger an egg Nibbin even if the source matches', async () => {
    const triggerRun = vi.fn();
    await dispatchForConnection(gmailEvent, {
      activeNibbinsForAccount: async () => [makeNibbin({ stage: 'egg' })],
      triggerRun,
    });
    expect(triggerRun).not.toHaveBeenCalled();
  });

  it('enforces the fan-out ceiling and marks capped=true', async () => {
    const triggerRun = vi.fn().mockResolvedValue(runOutcome);
    const nibbins = Array.from({ length: 8 }, (_, i) =>
      makeNibbin({ id: `nib-${i}` }),
    );
    const result = await dispatchForConnection(gmailEvent, {
      activeNibbinsForAccount: async () => nibbins,
      triggerRun,
      fanOutCeiling: 5,
    });
    expect(triggerRun).toHaveBeenCalledTimes(5);
    expect(result.capped).toBe(true);
    expect(result.triggered).toBe(5);
    expect(result.deferred).toBe(3); // 8 eligible − 5 ceiling
  });

  it('returns deferred=0 when not capped', async () => {
    const triggerRun = vi.fn().mockResolvedValue(runOutcome);
    const result = await dispatchForConnection(gmailEvent, {
      activeNibbinsForAccount: async () => [makeNibbin()],
      triggerRun,
    });
    expect(result.capped).toBe(false);
    expect(result.deferred).toBe(0);
  });

  it('skips Nibbins whose per-(event,nibbin) key recordOnce returns false', async () => {
    const triggerRun = vi.fn().mockResolvedValue(runOutcome);
    const nibbins = Array.from({ length: 3 }, (_, i) => makeNibbin({ id: `nib-${i}` }));
    // Simulate nib-0 already dispatched in a prior cycle
    const recordOnce = vi.fn().mockImplementation(async (key: string) => !key.endsWith(':nib-0'));
    const result = await dispatchForConnection(gmailEvent, {
      activeNibbinsForAccount: async () => nibbins,
      triggerRun,
      recordOnce,
    });
    expect(triggerRun).toHaveBeenCalledTimes(2); // nib-1 and nib-2 only
    expect(triggerRun).not.toHaveBeenCalledWith('nib-0', expect.anything());
    expect(result.triggered).toBe(2);
    expect(result.capped).toBe(false);
  });

  it('does not trigger Nibbins with kind=schedule or kind=user triggers only', async () => {
    const triggerRun = vi.fn();
    const schedNibbin = makeNibbin({
      spec: {
        ...makeNibbin().spec,
        triggers: [{ kind: 'schedule', schedule: 'daily.morning' }],
      },
    });
    await dispatchForConnection(gmailEvent, {
      activeNibbinsForAccount: async () => [schedNibbin],
      triggerRun,
    });
    expect(triggerRun).not.toHaveBeenCalled();
  });

  it('skips a paused Nibbin without erroring (runner handles it, dispatch skips early)', async () => {
    const triggerRun = vi.fn();
    await dispatchForConnection(gmailEvent, {
      activeNibbinsForAccount: async () => [makeNibbin({ status: 'paused' })],
      triggerRun,
    });
    expect(triggerRun).not.toHaveBeenCalled();
  });
});
