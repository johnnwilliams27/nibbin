import { expect, it, describe } from 'vitest';
import { SupabaseTrainingStore } from './stores';
import type { SupabaseClient } from '@supabase/supabase-js';

const ROW = {
  id: 'tw-1',
  account_id: 'acc1',
  nibbin_id: 'nib1',
  started_at: '2026-06-19T00:00:00.000Z',
  expires_at: '2026-06-26T00:00:00.000Z',
  max_runs: 50,
  runs_used: 3,
  novelty: false,
  ended_at: null,
  ended_reason: null,
};

function activeSvc(row: typeof ROW | null) {
  return {
    from: () => ({
      select: () => ({
        eq: () => ({
          eq: () => ({
            is: () => ({
              gt: () => ({ maybeSingle: () => ({ data: row, error: null }) }),
            }),
          }),
        }),
      }),
    }),
  } as unknown as SupabaseClient;
}

function rpcSvc(returns: unknown, captured: { name?: string; args?: unknown } = {}) {
  return {
    rpc: (name: string, args: unknown) => {
      captured.name = name;
      captured.args = args;
      return { data: returns, error: null };
    },
  } as unknown as SupabaseClient;
}

describe('SupabaseTrainingStore — additive, account-scoped, budget-bounded', () => {
  it('active maps an open in-budget row to a TrainingWindow', async () => {
    const store = new SupabaseTrainingStore(activeSvc(ROW));
    const w = await store.active('acc1', 'nib1', Date.parse('2026-06-20T00:00:00Z'));
    expect(w).not.toBeNull();
    expect(w!.runsUsed).toBe(3);
    expect(w!.maxRuns).toBe(50);
    expect(w!.accountId).toBe('acc1');
  });

  it('active returns null when there is no open window', async () => {
    const store = new SupabaseTrainingStore(activeSvc(null));
    expect(await store.active('acc1', 'nib1', Date.now())).toBeNull();
  });

  it('active returns null for an over-budget row (never samples over budget)', async () => {
    const store = new SupabaseTrainingStore(activeSvc({ ...ROW, runs_used: 50 }));
    expect(await store.active('acc1', 'nib1', Date.parse('2026-06-20T00:00:00Z'))).toBeNull();
  });

  it('open calls training_open with clamped seconds + budget', async () => {
    const captured: { name?: string; args?: unknown } = {};
    const store = new SupabaseTrainingStore(rpcSvc(ROW, captured));
    await store.open(
      { accountId: 'acc1', nibbinId: 'nib1', durationMs: 7 * 24 * 3600 * 1000, maxRuns: 50, novelty: true },
      Date.now(),
    );
    expect(captured.name).toBe('training_open');
    expect(captured.args).toMatchObject({ p_nibbin: 'nib1', p_duration_secs: 7 * 24 * 3600, p_max_runs: 50, p_novelty: true });
  });

  it('recordSample maps runs_remaining → runsUsed', async () => {
    const window = {
      id: 'tw-1', accountId: 'acc1', nibbinId: 'nib1', startedAtMs: 0,
      expiresAtMs: Date.now() + 1e9, maxRuns: 50, runsUsed: 3, novelty: false,
    };
    const store = new SupabaseTrainingStore(rpcSvc(46)); // 46 remaining → used 4
    const next = await store.recordSample(window, Date.now());
    expect(next.runsUsed).toBe(4);
    expect(next.endedReason).toBeUndefined();
  });

  it('recordSample treats NULL (not sampled) as a spent/closed window', async () => {
    const window = {
      id: 'tw-1', accountId: 'acc1', nibbinId: 'nib1', startedAtMs: 0,
      expiresAtMs: Date.now() + 1e9, maxRuns: 50, runsUsed: 50, novelty: false,
    };
    const store = new SupabaseTrainingStore(rpcSvc(null));
    const next = await store.recordSample(window, Date.now());
    expect(next.runsUsed).toBe(50);
    expect(next.endedReason).toBe('budget');
  });

  it('recordSample auto-closes when remaining hits 0', async () => {
    const window = {
      id: 'tw-1', accountId: 'acc1', nibbinId: 'nib1', startedAtMs: 0,
      expiresAtMs: Date.now() + 1e9, maxRuns: 5, runsUsed: 4, novelty: false,
    };
    const store = new SupabaseTrainingStore(rpcSvc(0)); // 0 remaining → used 5
    const next = await store.recordSample(window, Date.now());
    expect(next.runsUsed).toBe(5);
    expect(next.endedReason).toBe('budget');
  });

  it('close calls training_close with the reason', async () => {
    const captured: { name?: string; args?: unknown } = {};
    const store = new SupabaseTrainingStore(rpcSvc(undefined, captured));
    await store.close('acc1', 'nib1', 'user', Date.now());
    expect(captured.name).toBe('training_close');
    expect(captured.args).toMatchObject({ p_nibbin: 'nib1', p_reason: 'user' });
  });
});
