/**
 * decide.test.ts
 *
 * Unit tests for decideViaChannel (security-critical channel approval bridge)
 * and a regression smoke-test for the decideDraft refactor.
 *
 * Security invariant under test: an unverified sender, a non-member actor, or
 * a run not owned by the binding's account / not awaiting approval must ALL
 * return null with NO rpc call and NO state change. Only a fully-verified chain
 * (binding → account → active-member → own-run → awaiting) reaches decide_run_service.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

// ---------------------------------------------------------------------------
// Mock: ../supabase/service
// ---------------------------------------------------------------------------
// We intercept serviceClient() and replace it with a factory that returns a
// chainable stub. Each test seeds per-table rows via `seedTable`. The stub
// tracks all .rpc() calls so we can assert decide_run_service was/wasn't called.
// ---------------------------------------------------------------------------

const rpcSpy = vi.fn();

type Row = Record<string, unknown>;
type TableSeed = Row | Row[] | null;

let tableSeed: Record<string, TableSeed> = {};

function makeQueryChain(table: string) {
  // We build a chainable object. Every filter call returns `this` so tests can
  // chain .eq().eq()... arbitrarily. .maybeSingle() / .single() / .select()
  // with count options resolve from the seed.

  // Collected filters — we don't actually filter (seed is small); we just
  // resolve the seeded value for the table.

  const resolve = () => {
    const seed = tableSeed[table] ?? null;
    if (seed === null) return { data: null, error: null, count: 0 };
    if (Array.isArray(seed)) return { data: seed, error: null, count: seed.length };
    return { data: seed, error: null, count: seed ? 1 : 0 };
  };

  // A fully-chainable proxy that resolves at terminal calls.
  // Every method returns itself so arbitrary filter chains work regardless of depth.
  const self: Record<string, unknown> = {};
  const chainable = () => self;

  self['eq'] = chainable;
  self['in'] = chainable;
  self['order'] = chainable;
  self['limit'] = chainable;
  self['single'] = () => resolve();
  self['maybeSingle'] = () => resolve();

  self['select'] = (_cols?: string, opts?: { count?: string; head?: boolean }) => {
    if (opts?.count === 'exact') {
      // count-mode: build a sub-chain that resolves count at .eq().in() depth
      const { count } = resolve();
      // Build a deeply chainable object that resolves to { count, error: null }
      // when any terminal is reached. The actual query in decide.ts chains:
      //   .select(..., {count:'exact',head:true}).eq(...).in(..., [...])
      // so we need at least 1 eq + 1 in deep, then the result is awaited.
      const countResult = { count, error: null };
      // Proxy: every method returns something that also has eq/in and the count result fields
      function deepCountChain(): Record<string, unknown> {
        const c: Record<string, unknown> = { count, error: null };
        c['eq'] = deepCountChain;
        c['in'] = deepCountChain;
        c['order'] = deepCountChain;
        c['limit'] = deepCountChain;
        return c;
      }
      return deepCountChain();
    }
    return self;
  };

  return self;
}

function makeServiceClient() {
  const from = vi.fn((table: string) => makeQueryChain(table));
  const rpc = rpcSpy;
  return { from, rpc } as unknown as SupabaseClient;
}

vi.mock('../supabase/service', () => ({
  serviceClient: () => makeServiceClient(),
}));

// ---------------------------------------------------------------------------
// Mock: ./engine  (maybePromote)
// ---------------------------------------------------------------------------
const maybePromoteMock = vi.fn().mockResolvedValue(null);
vi.mock('./engine', () => ({
  maybePromote: (...args: unknown[]) => maybePromoteMock(...args),
  // other exports the module might have are not needed in these tests
  devSeedEnabled: () => false,
}));

// ---------------------------------------------------------------------------
// Mock: ./drift  (maybeDriftNudge)
// ---------------------------------------------------------------------------
const maybeDriftNudgeMock = vi.fn().mockResolvedValue(undefined);
vi.mock('./drift', () => ({
  maybeDriftNudge: (...args: unknown[]) => maybeDriftNudgeMock(...args),
}));

// ---------------------------------------------------------------------------
// Mock: ./stores  (SupabaseEventSink)
// ---------------------------------------------------------------------------
const emitMock = vi.fn().mockResolvedValue(undefined);
vi.mock('./stores', () => ({
  SupabaseEventSink: class {
    emit(...args: unknown[]) { return emitMock(...args); }
  },
  // other exports the module might have
  SupabaseRunStore: class {},
  SupabaseRoutineStore: class {},
  SupabaseGrantStore: class {},
  SupabaseIdempotencyStore: class {},
  SupabaseSendRecordStore: class {},
}));

// ---------------------------------------------------------------------------
// Import after mocks are set up
// ---------------------------------------------------------------------------
import { decideViaChannel, decideDraft } from './decide';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function seedTable(table: string, rows: TableSeed) {
  tableSeed[table] = rows;
}

function verifiedBinding(overrides: Partial<Row> = {}): Row {
  return {
    account_id: 'acct-1',
    linked_by: 'user-1',
    ...overrides,
  };
}

function activeMembership(): Row {
  return { id: 'mem-1' };
}

function awaitingRun(overrides: Partial<Row> = {}): Row {
  return {
    nibbin_id: 'nib-1',
    account_id: 'acct-1',
    status: 'awaiting_approval',
    ...overrides,
  };
}

function happyApprovalsCount(): Row[] {
  // count=1 simulates first approval
  return [{ id: 'appr-1' }];
}

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
  tableSeed = {};
  rpcSpy.mockReset();
  emitMock.mockReset().mockResolvedValue(undefined);
  maybePromoteMock.mockReset().mockResolvedValue(null);
  maybeDriftNudgeMock.mockReset().mockResolvedValue(undefined);
  rpcSpy.mockResolvedValue({ data: null, error: null });
});

// ===========================================================================
// decideViaChannel — security branch tests
// ===========================================================================

describe('decideViaChannel — security invariants', () => {

  it('returns null (no rpc) when binding does not exist (unverified sender)', async () => {
    // notification_channels returns null — binding absent
    seedTable('notification_channels', null);

    const result = await decideViaChannel('telegram', 'ext-99', 'run-1', 'approved');

    expect(result).toBeNull();
    expect(rpcSpy).not.toHaveBeenCalled();
  });

  it('returns null (no rpc) when linked_by is null (unattributable binding)', async () => {
    seedTable('notification_channels', verifiedBinding({ linked_by: null }));

    const result = await decideViaChannel('telegram', 'ext-1', 'run-1', 'approved');

    expect(result).toBeNull();
    expect(rpcSpy).not.toHaveBeenCalled();
  });

  it('returns null (no rpc) when actor is not an active member of the account', async () => {
    seedTable('notification_channels', verifiedBinding());
    // memberships returns empty array → count = 0
    seedTable('memberships', []);

    const result = await decideViaChannel('telegram', 'ext-1', 'run-1', 'approved');

    expect(result).toBeNull();
    expect(rpcSpy).not.toHaveBeenCalled();
  });

  it('returns null (no rpc) when run does not exist', async () => {
    seedTable('notification_channels', verifiedBinding());
    seedTable('memberships', [activeMembership()]);
    seedTable('runs', null); // run not found

    const result = await decideViaChannel('telegram', 'ext-1', 'run-missing', 'approved');

    expect(result).toBeNull();
    expect(rpcSpy).not.toHaveBeenCalled();
  });

  it('returns null (no rpc) when run belongs to a different account (cross-account attempt)', async () => {
    seedTable('notification_channels', verifiedBinding({ account_id: 'acct-1' }));
    seedTable('memberships', [activeMembership()]);
    // Run's account_id does NOT match the binding's account_id
    seedTable('runs', awaitingRun({ account_id: 'acct-EVIL' }));

    const result = await decideViaChannel('telegram', 'ext-1', 'run-1', 'approved');

    expect(result).toBeNull();
    expect(rpcSpy).not.toHaveBeenCalled();
  });

  it('returns null (no rpc) when run is not in awaiting_approval status', async () => {
    seedTable('notification_channels', verifiedBinding());
    seedTable('memberships', [activeMembership()]);
    seedTable('runs', awaitingRun({ status: 'completed' }));

    const result = await decideViaChannel('telegram', 'ext-1', 'run-1', 'approved');

    expect(result).toBeNull();
    expect(rpcSpy).not.toHaveBeenCalled();
  });

});

// ===========================================================================
// decideViaChannel — happy path
// ===========================================================================

describe('decideViaChannel — happy path', () => {

  beforeEach(() => {
    seedTable('notification_channels', verifiedBinding());
    seedTable('memberships', [activeMembership()]);
    seedTable('runs', awaitingRun());
    // approvals count = 1 → firstApproval = true
    seedTable('approvals', happyApprovalsCount());
  });

  it('calls decide_run_service with p_actor_user=linked_by and the correct decision', async () => {
    await decideViaChannel('telegram', 'ext-1', 'run-1', 'approved');

    expect(rpcSpy).toHaveBeenCalledOnce();
    expect(rpcSpy).toHaveBeenCalledWith('decide_run_service', {
      p_run: 'run-1',
      p_actor_user: 'user-1', // linked_by from the binding
      p_decision: 'approved',
      p_edit_distance: 0,
    });
  });

  it('propagates the rejection decision to decide_run_service correctly', async () => {
    await decideViaChannel('telegram', 'ext-1', 'run-1', 'rejected');

    expect(rpcSpy).toHaveBeenCalledWith('decide_run_service', expect.objectContaining({
      p_decision: 'rejected',
      p_actor_user: 'user-1',
    }));
  });

  it('returns a DecisionResult with decision, promotedTo and firstApproval', async () => {
    maybePromoteMock.mockResolvedValue('senior');

    const result = await decideViaChannel('telegram', 'ext-1', 'run-1', 'approved');

    expect(result).not.toBeNull();
    expect(result!.decision).toBe('approved');
    expect(result!.promotedTo).toBe('senior');
    // firstApproval depends on approval count == 1 (seeded above)
    expect(result!.firstApproval).toBe(true);
  });

  it('emits run_approved event after a successful approval', async () => {
    await decideViaChannel('telegram', 'ext-1', 'run-1', 'approved');

    const emitCalls = emitMock.mock.calls.map((c: unknown[]) => (c[0] as Record<string, unknown>).name);
    expect(emitCalls).toContain('run_approved');
  });

  it('emits run_rejected event after a successful rejection (no promotion, no firstApproval)', async () => {
    await decideViaChannel('telegram', 'ext-1', 'run-1', 'rejected');

    const emitCalls = emitMock.mock.calls.map((c: unknown[]) => (c[0] as Record<string, unknown>).name);
    expect(emitCalls).toContain('run_rejected');
  });

  it('throws (not returns null) when decide_run_service RPC returns an error', async () => {
    rpcSpy.mockResolvedValue({ data: null, error: { message: 'SQL guard: actor not member' } });

    await expect(
      decideViaChannel('telegram', 'ext-1', 'run-1', 'approved'),
    ).rejects.toThrow('decision failed:');
  });

});

// ===========================================================================
// decideDraft — refactor smoke test
// ===========================================================================

describe('decideDraft — refactor smoke test', () => {

  it('calls decide_run RPC on the session client and returns a DecisionResult', async () => {
    // Build a minimal session mock that tracks rpc calls
    const sessionRpcSpy = vi.fn().mockResolvedValue({ error: null });
    const sessionClient = {
      rpc: sessionRpcSpy,
    } as unknown as SupabaseClient;

    // Seed the service client (used inside decideDraft to read the run)
    seedTable('runs', { nibbin_id: 'nib-1', account_id: 'acct-1' });
    // Approvals count for TTFAD (0 → firstApproval = false)
    seedTable('approvals', []);

    const result = await decideDraft(sessionClient, 'acct-1', 'user-1', 'run-1', 'approved', 0);

    expect(sessionRpcSpy).toHaveBeenCalledWith('decide_run', {
      p_run: 'run-1',
      p_decision: 'approved',
      p_edit_distance: 0,
    });
    expect(result.decision).toBe('approved');
    expect(typeof result.firstApproval).toBe('boolean');
    expect(result.promotedTo).toBeNull();
  });

});
