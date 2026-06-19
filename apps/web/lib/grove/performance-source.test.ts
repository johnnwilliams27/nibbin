/**
 * Tests for the Slice B PerformanceSource (apps/web). The service client is
 * mocked so no DB is needed. Covers: count→rate derivation, fail-safe on a bad
 * read (no throw, empty/prior snapshot), TTL-gated refresh, and the cold-start
 * "everything is undefined until the first refresh lands" behavior that makes
 * route() byte-for-byte unchanged at boot.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const rpc = vi.fn();
vi.mock('../supabase/service', () => ({
  serviceClient: () => ({ rpc }),
}));

import { pgPerformanceSource } from './performance-source';

beforeEach(() => {
  rpc.mockReset();
});

/** Let the fire-and-forget refresh promise settle. */
async function flush() {
  await Promise.resolve();
  await Promise.resolve();
}

const row = (over: Record<string, unknown> = {}) => ({
  model: 'claude-haiku-4-5-20251001',
  task: 'specialist_draft',
  tier: 't1',
  calls: 100,
  decided_calls: 80,
  approved_unedited: 40,
  refusals: 2,
  errors: 3,
  avg_cost_microusd: 250,
  ...over,
});

describe('pgPerformanceSource', () => {
  it('returns undefined on a cold snapshot (route() unchanged at boot)', () => {
    rpc.mockResolvedValue({ data: [row()] });
    const src = pgPerformanceSource();
    // First synchronous read: snapshot is still empty (refresh is fire-and-forget).
    expect(src.getPerformance('claude-haiku-4-5-20251001', 'specialist_draft', 't1')).toBeUndefined();
  });

  it('derives rates from raw counts after the refresh lands', async () => {
    rpc.mockResolvedValue({ data: [row()] });
    const src = pgPerformanceSource();
    src.getPerformance('claude-haiku-4-5-20251001', 'specialist_draft', 't1'); // triggers refresh
    await flush();
    const stat = src.getPerformance('claude-haiku-4-5-20251001', 'specialist_draft', 't1');
    expect(stat).toBeDefined();
    expect(stat!.calls).toBe(100);
    expect(stat!.decidedCalls).toBe(80);
    expect(stat!.approvedUneditedRate).toBeCloseTo(40 / 80);
    expect(stat!.refusalErrorRate).toBeCloseTo((2 + 3) / 100);
    expect(stat!.avgCostMicroUsd).toBe(250);
  });

  it('zero-denominator rows produce 0 rates, not NaN', async () => {
    rpc.mockResolvedValue({
      data: [row({ calls: 0, decided_calls: 0, approved_unedited: 0, refusals: 0, errors: 0 })],
    });
    const src = pgPerformanceSource();
    src.getPerformance('claude-haiku-4-5-20251001', 'specialist_draft', 't1');
    await flush();
    const stat = src.getPerformance('claude-haiku-4-5-20251001', 'specialist_draft', 't1');
    expect(stat!.approvedUneditedRate).toBe(0);
    expect(stat!.refusalErrorRate).toBe(0);
  });

  it('fail-safe: a read error never throws and leaves the snapshot empty', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'boom' } });
    const src = pgPerformanceSource();
    expect(() => src.getPerformance('claude-haiku-4-5-20251001', 'specialist_draft', 't1')).not.toThrow();
    await flush();
    expect(src.getPerformance('claude-haiku-4-5-20251001', 'specialist_draft', 't1')).toBeUndefined();
  });

  it('keeps the prior snapshot when a later refresh fails', async () => {
    rpc.mockResolvedValueOnce({ data: [row()] });
    let clock = 1_000_000;
    const src = pgPerformanceSource({ ttlMs: 1000, now: () => clock });
    src.getPerformance('claude-haiku-4-5-20251001', 'specialist_draft', 't1');
    await flush();
    expect(src.getPerformance('claude-haiku-4-5-20251001', 'specialist_draft', 't1')).toBeDefined();

    // advance past TTL; next read triggers a refresh that fails.
    rpc.mockResolvedValueOnce({ data: null, error: { message: 'boom' } });
    clock += 2000;
    src.getPerformance('claude-haiku-4-5-20251001', 'specialist_draft', 't1');
    await flush();
    // prior good data survives the bad read.
    expect(src.getPerformance('claude-haiku-4-5-20251001', 'specialist_draft', 't1')).toBeDefined();
  });

  it('does not re-issue the RPC within the TTL window', async () => {
    rpc.mockResolvedValue({ data: [row()] });
    const src = pgPerformanceSource({ ttlMs: 10_000, now: () => 1_000_000 });
    src.getPerformance('claude-haiku-4-5-20251001', 'specialist_draft', 't1');
    await flush();
    src.getPerformance('claude-haiku-4-5-20251001', 'specialist_draft', 't1');
    src.getPerformance('claude-haiku-4-5-20251001', 'specialist_draft', 't1');
    await flush();
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it('skips rows missing model/task/tier', async () => {
    rpc.mockResolvedValue({ data: [row({ model: '' }), row({ task: 'scan_synthesis' })] });
    const src = pgPerformanceSource();
    src.getPerformance('claude-haiku-4-5-20251001', 'scan_synthesis', 't1');
    await flush();
    expect(src.getPerformance('claude-haiku-4-5-20251001', 'scan_synthesis', 't1')).toBeDefined();
    expect(src.getPerformance('', 'specialist_draft', 't1')).toBeUndefined();
  });
});
