/**
 * Routing-reinforcement Slice A — scoreboard read-layer tests.
 *
 * Asserts: rate derivation is correct over raw view counts; division is
 * null-safe (no decided calls / no calls → null, never NaN/Infinity); the read
 * propagates the RPC error so a non-staff / unauthorized caller surfaces as a
 * thrown error rather than silently returning data.
 */
import { describe, it, expect } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { deriveRates, loadScoreboard, type PerformanceRow } from './read';

const FULL_ROW: PerformanceRow = {
  model: 'claude-haiku-4-5-20251001',
  task: 'specialist_draft',
  tier: 't1',
  calls: 100,
  decided_calls: 40,
  approved_unedited: 30,
  edited: 8,
  rejected: 2,
  avg_edit_distance: 1.5,
  refusals: 5,
  errors: 3,
  degraded_calls: 10,
  avg_cost_microusd: 1200,
  total_cost_microusd: 120000,
  avg_latency_ms: 850,
  last_call_at: '2026-06-18T00:00:00Z',
};

describe('deriveRates — quality/outcome/degradation rates from raw counts', () => {
  it('computes approved-unedited / edited / rejected over decided_calls', () => {
    const r = deriveRates(FULL_ROW);
    expect(r.approvedUneditedRate).toBeCloseTo(30 / 40);
    expect(r.editedRate).toBeCloseTo(8 / 40);
    expect(r.rejectedRate).toBeCloseTo(2 / 40);
  });

  it('computes refusal / error / degradation rates over calls', () => {
    const r = deriveRates(FULL_ROW);
    expect(r.refusalRate).toBeCloseTo(5 / 100);
    expect(r.errorRate).toBeCloseTo(3 / 100);
    expect(r.degradationRate).toBeCloseTo(10 / 100);
  });

  it('returns null quality rates when there are no decided calls (no divide-by-zero)', () => {
    // A diagnosis/chat-style model with calls but NO run_id/approval rows.
    const noDecided: PerformanceRow = {
      ...FULL_ROW,
      task: 'chat',
      calls: 50,
      decided_calls: 0,
      approved_unedited: 0,
      edited: 0,
      rejected: 0,
      avg_edit_distance: null,
      refusals: 2,
      errors: 1,
      degraded_calls: 4,
    };
    const r = deriveRates(noDecided);
    expect(r.approvedUneditedRate).toBeNull();
    expect(r.editedRate).toBeNull();
    expect(r.rejectedRate).toBeNull();
    // Outcome rates over calls are still defined.
    expect(r.refusalRate).toBeCloseTo(2 / 50);
    expect(r.degradationRate).toBeCloseTo(4 / 50);
  });

  it('returns null outcome rates when there are no calls at all', () => {
    const empty: PerformanceRow = {
      ...FULL_ROW,
      calls: 0,
      decided_calls: 0,
      approved_unedited: 0,
      edited: 0,
      rejected: 0,
      refusals: 0,
      errors: 0,
      degraded_calls: 0,
    };
    const r = deriveRates(empty);
    expect(r.approvedUneditedRate).toBeNull();
    expect(r.refusalRate).toBeNull();
    expect(r.errorRate).toBeNull();
    expect(r.degradationRate).toBeNull();
  });
});

describe('view contract — two models on one task; no-run_id calls in volume not quality', () => {
  // Mirrors what the SQL view emits: two models for one task. Model A has
  // approval rows (drafting-style); Model B is a diagnosis/chat-style model whose
  // calls have NO run_id, so they count in `calls` but never in decided_calls or
  // the quality columns. The 30-day window is applied SQL-side; the read layer
  // derives rates over whatever counts it is handed.
  const modelA: PerformanceRow = {
    model: 'model-a',
    task: 'specialist_draft',
    tier: 't1',
    calls: 20,
    decided_calls: 20,
    approved_unedited: 16,
    edited: 3,
    rejected: 1,
    avg_edit_distance: 0.4,
    refusals: 0,
    errors: 1,
    degraded_calls: 2,
    avg_cost_microusd: 900,
    total_cost_microusd: 18000,
    avg_latency_ms: 700,
    last_call_at: '2026-06-18T00:00:00Z',
  };
  // Same task, different model, NO approvals (run_id-less calls) → decided_calls 0.
  const modelB: PerformanceRow = {
    model: 'model-b',
    task: 'specialist_draft',
    tier: 't1',
    calls: 12,
    decided_calls: 0,
    approved_unedited: 0,
    edited: 0,
    rejected: 0,
    avg_edit_distance: null,
    refusals: 1,
    errors: 0,
    degraded_calls: 0,
    avg_cost_microusd: 500,
    total_cost_microusd: 6000,
    avg_latency_ms: 400,
    last_call_at: '2026-06-17T00:00:00Z',
  };

  it('derives quality for the decided model and leaves the run_id-less model null', async () => {
    const admin = {
      rpc: async () => ({ data: [modelA, modelB], error: null }),
    } as unknown as SupabaseClient;
    const rows = await loadScoreboard(admin);
    const a = rows.find((r) => r.model === 'model-a')!;
    const b = rows.find((r) => r.model === 'model-b')!;
    expect(a.approvedUneditedRate).toBeCloseTo(16 / 20);
    expect(a.degradationRate).toBeCloseTo(2 / 20);
    // Model B's calls show in volume + outcome, but quality is null (no decided).
    expect(b.calls).toBe(12);
    expect(b.decided_calls).toBe(0);
    expect(b.approvedUneditedRate).toBeNull();
    expect(b.refusalRate).toBeCloseTo(1 / 12);
  });
});

describe('loadScoreboard — staff-gated RPC read', () => {
  it('maps the RPC rows through deriveRates', async () => {
    const admin = {
      rpc: async () => ({ data: [FULL_ROW], error: null }),
    } as unknown as SupabaseClient;
    const rows = await loadScoreboard(admin);
    expect(rows).toHaveLength(1);
    expect(rows[0].approvedUneditedRate).toBeCloseTo(30 / 40);
  });

  it('throws when the RPC rejects the caller (non-staff / insufficient_privilege)', async () => {
    // The RPC is granted to service_role only and the page asserts staff first;
    // a non-staff caller surfaces as an RPC error, which must propagate (never
    // silently return empty data masquerading as "no calls").
    const admin = {
      rpc: async () => ({ data: null, error: { message: 'permission denied for function model_task_performance_read' } }),
    } as unknown as SupabaseClient;
    await expect(loadScoreboard(admin)).rejects.toThrow(/model_task_performance_read failed/);
  });

  it('returns an empty array when the RPC returns no rows', async () => {
    const admin = {
      rpc: async () => ({ data: [], error: null }),
    } as unknown as SupabaseClient;
    await expect(loadScoreboard(admin)).resolves.toEqual([]);
  });

  it('throws on a drifted RPC row shape instead of deriving NaN rates', async () => {
    // A renamed/retyped count column (here decided_calls missing) would make the
    // rate math NaN under an unchecked cast. The shape guard rejects it cleanly.
    const drifted = { ...FULL_ROW } as Record<string, unknown>;
    delete drifted.decided_calls;
    const admin = {
      rpc: async () => ({ data: [drifted], error: null }),
    } as unknown as SupabaseClient;
    await expect(loadScoreboard(admin)).rejects.toThrow(/unexpected row shape/);
  });
});
