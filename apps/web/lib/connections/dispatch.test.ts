import { describe, it, expect, vi } from 'vitest';
import { dispatchForConnection, type ConnectorEvent } from './dispatch';
import type { NibbinRef, RunOutcome } from '@nibbin/runtime';

function makeNibbin(overrides: Partial<NibbinRef> = {}): NibbinRef {
  return {
    id: 'nib-1',
    accountId: 'acct-1',
    name: 'Scribe',
    stage: 'student',
    stageChangedAt: 0,
    status: 'active',
    spec: {
      templateKey: 'scribe',
      version: 1,
      displayName: 'Scribe',
      toolsAllowlist: ['email.read', 'email.send'],
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

  it('does not double-count a Nibbin whose per-(event,nibbin) recordOnce returns false', async () => {
    const triggerRun = vi.fn().mockResolvedValue(runOutcome);
    const nibbins = Array.from({ length: 3 }, (_, i) => makeNibbin({ id: `nib-${i}` }));
    // Simulate nib-0 already dispatched in a prior cycle. recordOnce is committed
    // AFTER triggerRun (claim-then-commit), and triggerRun is idempotent on
    // dedupeKey — so nib-0's re-fire is absorbed at the run layer and is simply
    // not counted toward `triggered`.
    const recordOnce = vi.fn().mockImplementation(async (key: string) => !key.endsWith(':nib-0'));
    const result = await dispatchForConnection(gmailEvent, {
      activeNibbinsForAccount: async () => nibbins,
      triggerRun,
      recordOnce,
    });
    // nib-1 and nib-2 are first-fires; nib-0 only counts as a deduped re-fire.
    expect(result.triggered).toBe(2);
    expect(result.capped).toBe(false);
  });

  it('does not consume recordOnce for deferred Nibbins, so they fire on the next cycle (P2.4)', async () => {
    const nibbins = Array.from({ length: 7 }, (_, i) => makeNibbin({ id: `nib-${i}` }));
    // A real-ish recordOnce: a key is "first" exactly once, then sticks.
    const recorded = new Set<string>();
    const recordOnce = vi.fn().mockImplementation(async (key: string) => {
      if (recorded.has(key)) return false;
      recorded.add(key);
      return true;
    });

    // Cycle 1: 7 eligible, ceiling 5 → 5 fire, 2 deferred. The 2 deferred must
    // NOT have had their recordOnce key consumed.
    const triggerRun1 = vi.fn().mockResolvedValue(runOutcome);
    const r1 = await dispatchForConnection(gmailEvent, {
      activeNibbinsForAccount: async () => nibbins,
      triggerRun: triggerRun1,
      recordOnce,
      fanOutCeiling: 5,
    });
    expect(r1.triggered).toBe(5);
    expect(r1.capped).toBe(true);
    expect(r1.deferred).toBe(2);
    // Only 5 keys were recorded; the 2 deferred Nibbins were never claimed.
    expect(recorded.size).toBe(5);

    // Cycle 2 (cursor not advanced → same event): the 5 already-fired Nibbins are
    // skipped (recordOnce false, deduped re-fire), and the 2 previously deferred
    // ones now fire as first-timers.
    const triggerRun2 = vi.fn().mockResolvedValue(runOutcome);
    const r2 = await dispatchForConnection(gmailEvent, {
      activeNibbinsForAccount: async () => nibbins,
      triggerRun: triggerRun2,
      recordOnce,
      fanOutCeiling: 5,
    });
    expect(r2.triggered).toBe(2); // the two previously deferred Nibbins
    expect(r2.capped).toBe(false);
    expect(r2.deferred).toBe(0);
    expect(recorded.size).toBe(7); // all seven now claimed
  });

  it('does not permanently swallow a trigger when triggerRun fails (P2.5)', async () => {
    const nibbin = makeNibbin({ id: 'nib-0' });
    const recorded = new Set<string>();
    const recordOnce = vi.fn().mockImplementation(async (key: string) => {
      if (recorded.has(key)) return false;
      recorded.add(key);
      return true;
    });

    // Cycle 1: triggerRun throws. The key must NOT be recorded (claim-then-commit).
    const failingTrigger = vi.fn().mockRejectedValue(new Error('runner down'));
    await expect(
      dispatchForConnection(gmailEvent, {
        activeNibbinsForAccount: async () => [nibbin],
        triggerRun: failingTrigger,
        recordOnce,
      }),
    ).rejects.toThrow('runner down');
    expect(recordOnce).not.toHaveBeenCalled(); // recordOnce only runs after success
    expect(recorded.size).toBe(0);

    // Cycle 2 (retry): triggerRun now succeeds and the trigger fires — not swallowed.
    const okTrigger = vi.fn().mockResolvedValue(runOutcome);
    const result = await dispatchForConnection(gmailEvent, {
      activeNibbinsForAccount: async () => [nibbin],
      triggerRun: okTrigger,
      recordOnce,
    });
    expect(okTrigger).toHaveBeenCalledOnce();
    expect(result.triggered).toBe(1);
    expect(recorded.size).toBe(1);
  });

  it('skips already-fired Nibbins BEFORE triggerRun on a capped re-poll (#113)', async () => {
    const nibbins = Array.from({ length: 7 }, (_, i) => makeNibbin({ id: `nib-${i}` }));
    const recorded = new Set<string>();
    const alreadyDispatched = vi.fn(async (key: string) => recorded.has(key));
    const recordOnce = vi.fn(async (key: string) => {
      if (recorded.has(key)) return false;
      recorded.add(key);
      return true;
    });

    // Cycle 1: ceiling 5 → 5 fire (and get recorded), 2 deferred.
    const triggerRun1 = vi.fn().mockResolvedValue(runOutcome);
    const r1 = await dispatchForConnection(gmailEvent, {
      activeNibbinsForAccount: async () => nibbins,
      triggerRun: triggerRun1,
      alreadyDispatched,
      recordOnce,
      fanOutCeiling: 5,
    });
    expect(r1.triggered).toBe(5);
    expect(r1.deferred).toBe(2);
    expect(triggerRun1).toHaveBeenCalledTimes(5);

    // Cycle 2 (cursor parked → same event): the 5 already-fired Nibbins are
    // skipped at the dispatch layer — triggerRun is NOT re-invoked for them
    // (the #113 fix). Only the 2 previously deferred Nibbins fire. Under the old
    // behaviour triggerRun would have been called 7 times (5 deduped + 2 new),
    // re-spending model budget gated only by the admission debounce.
    const triggerRun2 = vi.fn().mockResolvedValue(runOutcome);
    const r2 = await dispatchForConnection(gmailEvent, {
      activeNibbinsForAccount: async () => nibbins,
      triggerRun: triggerRun2,
      alreadyDispatched,
      recordOnce,
      fanOutCeiling: 5,
    });
    expect(triggerRun2).toHaveBeenCalledTimes(2);
    expect(r2.triggered).toBe(2);
    expect(r2.capped).toBe(false);
    expect(r2.deferred).toBe(0);
    expect(recorded.size).toBe(7);
  });

  it('alreadyDispatched is read-only — a failed triggerRun is still retried (P2.5 holds with #113)', async () => {
    const nibbin = makeNibbin({ id: 'nib-0' });
    const recorded = new Set<string>();
    const alreadyDispatched = vi.fn(async (key: string) => recorded.has(key));
    const recordOnce = vi.fn(async (key: string) => {
      if (recorded.has(key)) return false;
      recorded.add(key);
      return true;
    });

    // Cycle 1: triggerRun throws. alreadyDispatched must NOT have claimed the key,
    // and recordOnce never runs — so nothing is recorded.
    const failing = vi.fn().mockRejectedValue(new Error('runner down'));
    await expect(
      dispatchForConnection(gmailEvent, {
        activeNibbinsForAccount: async () => [nibbin],
        triggerRun: failing,
        alreadyDispatched,
        recordOnce,
      }),
    ).rejects.toThrow('runner down');
    expect(recordOnce).not.toHaveBeenCalled();
    expect(recorded.size).toBe(0);

    // Cycle 2 (retry): alreadyDispatched still false → the trigger fires, not swallowed.
    const ok = vi.fn().mockResolvedValue(runOutcome);
    const r = await dispatchForConnection(gmailEvent, {
      activeNibbinsForAccount: async () => [nibbin],
      triggerRun: ok,
      alreadyDispatched,
      recordOnce,
    });
    expect(ok).toHaveBeenCalledOnce();
    expect(r.triggered).toBe(1);
    expect(recorded.size).toBe(1);
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
