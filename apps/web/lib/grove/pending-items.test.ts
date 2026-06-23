/**
 * Tests for loadPendingItems — Task 2 (P6 attention-queue).
 * Uses a mock Supabase client object; no DB required.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { loadPendingItems } from './pending-items';

const ACCOUNT_ID = 'acc-111';

// ── Supabase query chain builder ─────────────────────────────────────────────
// Each call to `from()` needs its own chainable mock. We build a minimal
// fluent mock that resolves with the configured data at the leaf call.

function makeChain(resolve: () => Promise<{ data: unknown; error: unknown }>) {
  const chain: Record<string, unknown> = {};
  const methods = ['select', 'eq', 'is', 'in', 'order', 'limit', 'not'];
  for (const m of methods) {
    chain[m] = vi.fn(() => chain);
  }
  // Terminal: the query resolves when awaited
  chain.then = (ok: (v: unknown) => unknown, fail: (e: unknown) => unknown) =>
    resolve().then(ok, fail);
  return chain;
}

function makeSupabase(chains: ReturnType<typeof makeChain>[]) {
  let call = 0;
  return {
    from: vi.fn(() => chains[call++]),
  };
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('loadPendingItems', () => {
  it('2a. empty state — returns zero-filled PendingQueue', async () => {
    const notifChain = makeChain(async () => ({ data: [], error: null }));
    const runsChain = makeChain(async () => ({ data: [], error: null }));
    const supabase = makeSupabase([notifChain, runsChain]);

    const result = await loadPendingItems(supabase as never, ACCOUNT_ID);

    expect(result).toEqual({
      proposals: [],
      runs: [],
      total: 0,
      hasHighStakes: false,
    });
  });

  it('2b. single high-stakes proposal — hasHighStakes=true, total=1', async () => {
    const propId = 'prop-abc';
    const notifChain = makeChain(async () => ({
      data: [
        {
          id: 'notif-1',
          source_id: propId,
          payload: {},
          stakes: 'high',
          created_at: '2026-06-23T10:00:00Z',
        },
      ],
      error: null,
    }));
    const proposalsChain = makeChain(async () => ({
      data: [{ id: propId, field_key: 'pricing', rationale: 'Raised rates' }],
      error: null,
    }));
    const runsChain = makeChain(async () => ({ data: [], error: null }));
    const supabase = makeSupabase([notifChain, proposalsChain, runsChain]);

    const result = await loadPendingItems(supabase as never, ACCOUNT_ID);

    expect(result.hasHighStakes).toBe(true);
    expect(result.proposals).toHaveLength(1);
    expect(result.proposals[0].stakes).toBe('high');
    expect(result.proposals[0].proposalId).toBe(propId);
    expect(result.proposals[0].fieldKey).toBe('pricing');
    expect(result.total).toBe(1);
    expect(result.runs).toHaveLength(0);
  });

  it('2c. rationale truncation — 100-char rationale truncated to 80 chars + ellipsis', async () => {
    const longRationale = 'A'.repeat(100);
    const propId = 'prop-trunc';
    const notifChain = makeChain(async () => ({
      data: [
        {
          id: 'notif-2',
          source_id: propId,
          payload: {},
          stakes: 'normal',
          created_at: '2026-06-23T10:00:00Z',
        },
      ],
      error: null,
    }));
    const proposalsChain = makeChain(async () => ({
      data: [{ id: propId, field_key: 'voice', rationale: longRationale }],
      error: null,
    }));
    const runsChain = makeChain(async () => ({ data: [], error: null }));
    const supabase = makeSupabase([notifChain, proposalsChain, runsChain]);

    const result = await loadPendingItems(supabase as never, ACCOUNT_ID);

    expect(result.proposals[0].rationale).toBe('A'.repeat(79) + '…');
    expect(result.proposals[0].rationale.length).toBe(80);
  });

  it('2d. mixed proposals + runs — total=3', async () => {
    const notifChain = makeChain(async () => ({
      data: [
        { id: 'n1', source_id: 'p1', payload: {}, stakes: 'normal', created_at: '2026-06-23T09:00:00Z' },
        { id: 'n2', source_id: 'p2', payload: {}, stakes: 'normal', created_at: '2026-06-23T08:00:00Z' },
      ],
      error: null,
    }));
    const proposalsChain = makeChain(async () => ({
      data: [
        { id: 'p1', field_key: 'pricing', rationale: 'New rates' },
        { id: 'p2', field_key: 'faq', rationale: 'Updated FAQ' },
      ],
      error: null,
    }));
    const runsChain = makeChain(async () => ({
      data: [
        {
          id: 'run-1',
          nibbins: { name: 'Email Nibbin' },
          run_steps: [{ kind: 'draft', payload: { subject: 'Invoice follow-up' } }],
        },
      ],
      error: null,
    }));
    const supabase = makeSupabase([notifChain, proposalsChain, runsChain]);

    const result = await loadPendingItems(supabase as never, ACCOUNT_ID);

    expect(result.proposals).toHaveLength(2);
    expect(result.runs).toHaveLength(1);
    expect(result.total).toBe(3);
  });

  it('2e. ordering — high-stakes proposal appears before normal-stakes in proposals array', async () => {
    // The DB query orders by stakes DESC, created_at DESC.
    // We trust the mock returns them in the order the implementation sends them through.
    // Since ordering is delegated to the DB query, we verify the implementation
    // preserves the order returned by the notif query.
    const notifChain = makeChain(async () => ({
      data: [
        { id: 'n-high', source_id: 'p-high', payload: {}, stakes: 'high', created_at: '2026-06-23T09:00:00Z' },
        { id: 'n-norm', source_id: 'p-norm', payload: {}, stakes: 'normal', created_at: '2026-06-23T08:00:00Z' },
      ],
      error: null,
    }));
    const proposalsChain = makeChain(async () => ({
      data: [
        { id: 'p-high', field_key: 'pricing', rationale: 'Conflict detected' },
        { id: 'p-norm', field_key: 'faq', rationale: 'Routine update' },
      ],
      error: null,
    }));
    const runsChain = makeChain(async () => ({ data: [], error: null }));
    const supabase = makeSupabase([notifChain, proposalsChain, runsChain]);

    const result = await loadPendingItems(supabase as never, ACCOUNT_ID);

    // First proposal must be the high-stakes one (order comes from notif query stakes DESC)
    expect(result.proposals[0].stakes).toBe('high');
    expect(result.proposals[1].stakes).toBe('normal');
  });

  it('2f. null rationale — rationale="" with no crash', async () => {
    const propId = 'prop-null-rat';
    const notifChain = makeChain(async () => ({
      data: [
        {
          id: 'notif-nr',
          source_id: propId,
          payload: {},
          stakes: 'normal',
          created_at: '2026-06-23T10:00:00Z',
        },
      ],
      error: null,
    }));
    const proposalsChain = makeChain(async () => ({
      data: [{ id: propId, field_key: 'policies', rationale: null }],
      error: null,
    }));
    const runsChain = makeChain(async () => ({ data: [], error: null }));
    const supabase = makeSupabase([notifChain, proposalsChain, runsChain]);

    const result = await loadPendingItems(supabase as never, ACCOUNT_ID);

    expect(result.proposals[0].rationale).toBe('');
    expect(result.proposals).toHaveLength(1);
  });

  it('run step title extracted from draft step payload.subject', async () => {
    const notifChain = makeChain(async () => ({ data: [], error: null }));
    const runsChain = makeChain(async () => ({
      data: [
        {
          id: 'run-99',
          nibbins: { name: 'Invoice Bot' },
          run_steps: [
            { kind: 'read', payload: {} },
            { kind: 'draft', payload: { subject: 'Overdue invoice nudge' } },
          ],
        },
      ],
      error: null,
    }));
    const supabase = makeSupabase([notifChain, runsChain]);

    const result = await loadPendingItems(supabase as never, ACCOUNT_ID);

    expect(result.runs[0].runId).toBe('run-99');
    expect(result.runs[0].nibbinName).toBe('Invoice Bot');
    expect(result.runs[0].title).toBe('Overdue invoice nudge');
  });

  it('run with no draft step — title is null (no crash)', async () => {
    const notifChain = makeChain(async () => ({ data: [], error: null }));
    const runsChain = makeChain(async () => ({
      data: [
        {
          id: 'run-empty',
          nibbins: { name: 'Scanner' },
          run_steps: [],
        },
      ],
      error: null,
    }));
    const supabase = makeSupabase([notifChain, runsChain]);

    const result = await loadPendingItems(supabase as never, ACCOUNT_ID);

    expect(result.runs[0].title).toBeNull();
  });

  it('DB error on notif query — returns empty queue without throwing', async () => {
    const notifChain = makeChain(async () => ({ data: null, error: { message: 'db error' } }));
    const runsChain = makeChain(async () => ({ data: [], error: null }));
    const supabase = makeSupabase([notifChain, runsChain]);

    const result = await loadPendingItems(supabase as never, ACCOUNT_ID);

    expect(result).toEqual({ proposals: [], runs: [], total: 0, hasHighStakes: false });
  });
});
