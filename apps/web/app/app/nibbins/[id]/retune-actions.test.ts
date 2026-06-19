/**
 * Tests for retune-actions.ts (Task 2 — Agent Versioning Slice 1).
 *
 * Mock strategy mirrors the sibling actions.test.ts in apps/web/app/app/diagnosis:
 *  - appSession is mocked to return a fixed user+account.
 *  - serviceClient is mocked so we can intercept Supabase calls.
 *  - activeConnections returns a stable set of providers.
 *  - validateComposedSpec and validateTriggerGraph are imported from the REAL
 *    @nibbin/runtime so we exercise the real validation logic (not stubs).
 *    We exercise an *invalid* spec by supplying a steps array that will
 *    provably fail validation (unknown capability) — no need to mock.
 *
 * Three contracts verified:
 *  (a) A valid edit calls retune_nibbin once with the authed account.
 *  (b) An invalid spec (validation failure) does NOT call the RPC.
 *  (c) A Nibbin not owned by the account is rejected before reaching the RPC.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { AgentSpec } from '@nibbin/runtime';

// Mock next/cache so revalidatePath doesn't throw "static generation store missing"
// in the test environment (same pattern the sibling action tests follow).
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

/* ── Fixtures ──────────────────────────────────────────────────────────────── */

const ACCOUNT_ID = 'acct-test-1';
const USER_ID = 'user-test-1';
const NIBBIN_ID = 'nibbin-test-1';
const SPEC_ID = 'spec-test-1';

/**
 * A valid composed spec (nudge.overdue-email + gmail) that will pass
 * validateComposedSpec when providers=['gmail'].
 */
const VALID_SPEC_ROW = {
  id: SPEC_ID,
  account_id: ACCOUNT_ID,
  template_key: null,
  version: 2,
  display_name: 'Overdue follow-ups',
  tools_allowlist: ['email.read', 'email.draft'],
  required_connectors: ['gmail'],
  triggers: [
    { kind: 'schedule', schedule: 'daily.morning', cooldownSecs: 3600 },
    { kind: 'user' },
  ],
  curriculum: {
    measures: 'overdue-reply drafts approved without edits',
    promotion: { windowRuns: 25, minApprovedUneditedPct: 0.95, coverageMinPatterns: 4 },
    routineMinApprovals: 5,
  },
  credit_profile: {
    weightClass: 'standard',
    ceilings: { maxSteps: 120, maxTokens: 12_000, maxWallClockMs: 60_000 },
  },
  steps: [{ capability: 'nudge.overdue-email', inputs: { staleDays: 3 } }],
  persona_policy: { tone: 'warm, plainspoken' },
  // nibbins!inner used by accountSpecs — not present on this row, but nibbins is
  // a separate query.
} as const;

// The retune RPC stub returns a new spec id.
const NEW_SPEC_ID = 'spec-test-2';

/* ── Mocks ─────────────────────────────────────────────────────────────────── */

// retune_nibbin RPC stub — controlled per test via mockReturnValue.
const rpcFn = vi.fn();

// Tracks what the from() call was last asked for so we can return different
// data for 'nibbins' vs 'agent_specs' calls.
let fromResolver: ((table: string) => unknown) = () => ({ data: [], error: null });

const mockRpc = rpcFn;
const mockFrom = vi.fn((table: string) => {
  const resolved = fromResolver(table);
  // Build a chain that resolves to the table-specific value.
  const chain: Record<string, unknown> = {};
  const self = () => chain;
  chain.select = self;
  chain.eq = self;
  chain.neq = self;
  chain.single = () => Promise.resolve(resolved);
  chain.then = undefined;
  return chain;
});

vi.mock('../../../../lib/auth/app-session', () => ({
  appSession: vi.fn(async () => ({
    user: { id: USER_ID },
    accountId: ACCOUNT_ID,
    supabase: {},
  })),
}));

vi.mock('../../../../lib/supabase/service', () => ({
  serviceClient: vi.fn(() => ({
    from: mockFrom,
    rpc: mockRpc,
  })),
}));

vi.mock('../../../../lib/runtime/engine', () => ({
  activeConnections: vi.fn(async () => [{ provider: 'gmail' }]),
  specFromRow: vi.fn((row: Record<string, unknown>) => ({
    templateKey: row.template_key ?? null,
    version: row.version as number,
    displayName: row.display_name as string,
    toolsAllowlist: row.tools_allowlist as string[],
    requiredConnectors: row.required_connectors as string[],
    triggers: row.triggers as AgentSpec['triggers'],
    curriculum: row.curriculum as AgentSpec['curriculum'],
    creditProfile: row.credit_profile as AgentSpec['creditProfile'],
    steps: (row.steps as AgentSpec['steps']) ?? [],
    personaPolicy: (row.persona_policy as AgentSpec['personaPolicy']) ?? {},
  })),
}));

/* ── Tests ─────────────────────────────────────────────────────────────────── */

describe('retuneNibbin', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: nibbin exists and belongs to the account.
    fromResolver = (table) => {
      if (table === 'nibbins') {
        return { data: { spec_id: SPEC_ID, agent_specs: VALID_SPEC_ROW }, error: null };
      }
      if (table === 'agent_specs') {
        // accountSpecs: nibbins!inner join — return an array.
        return { data: [VALID_SPEC_ROW], error: null };
      }
      return { data: null, error: { message: 'unexpected table' } };
    };
    rpcFn.mockResolvedValue({ data: NEW_SPEC_ID, error: null });
  });

  it('(a) calls retune_nibbin once with the authed account when the spec is valid', async () => {
    const { retuneNibbin } = await import('./retune-actions');

    const result = await retuneNibbin(NIBBIN_ID, {
      steps: [{ capability: 'nudge.overdue-email', inputs: { staleDays: 7 } }],
      displayName: 'Chasing overdue replies',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error);

    // RPC called exactly once.
    expect(rpcFn).toHaveBeenCalledTimes(1);

    // Called with the authed account (never a caller-supplied one).
    const [rpcName, rpcArgs] = rpcFn.mock.calls[0] as [string, Record<string, unknown>];
    expect(rpcName).toBe('retune_nibbin');
    expect(rpcArgs.p_account).toBe(ACCOUNT_ID);
    expect(rpcArgs.p_actor_user).toBe(USER_ID);
    expect(rpcArgs.p_nibbin).toBe(NIBBIN_ID);

    // Returns the new spec id and incremented version.
    expect(result.newSpecId).toBe(NEW_SPEC_ID);
    expect(result.version).toBe(3); // current.version (2) + 1
  });

  it('(b) does NOT call retune_nibbin and returns an error when the spec fails validation', async () => {
    const { retuneNibbin } = await import('./retune-actions');

    // An unknown capability id will fail validateComposedSpec.
    const result = await retuneNibbin(NIBBIN_ID, {
      steps: [{ capability: 'DOES_NOT_EXIST_AT_ALL', inputs: {} }],
    });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(result.error).toMatch(/validation failed/i);

    // The RPC must never be called when validation fails.
    expect(rpcFn).not.toHaveBeenCalled();
  });

  it('(c) rejects a Nibbin that does not belong to the session account', async () => {
    // Supabase returns no row (ownership query with .eq('account_id') yields empty).
    fromResolver = (table) => {
      if (table === 'nibbins') {
        return { data: null, error: { message: 'no rows' } };
      }
      return { data: [], error: null };
    };

    const { retuneNibbin } = await import('./retune-actions');

    const result = await retuneNibbin('nibbin-belonging-to-other-account', {
      steps: [{ capability: 'nudge.overdue-email', inputs: { staleDays: 3 } }],
    });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected rejection');
    expect(result.error).toMatch(/not found/i);

    // Must not call the RPC.
    expect(rpcFn).not.toHaveBeenCalled();
  });
});
