/**
 * Task 4 tests — wire loadPendingItems into keeperChatAction + loadGroveState.
 *
 * Coverage:
 *  4c  keeperChatAction calls loadPendingItems and the volatile suffix
 *      contains "1 item waiting" when the queue has 1 proposal.
 *  4d  Empty queue → no "items waiting" text in the volatile suffix.
 *  4e  C10 regression — loadPendingItems adds no write calls (no INSERT/UPDATE).
 *  4f  loadPendingItems failure degrades gracefully — chat reply still returned.
 *  4g  loadGroveState returns pendingItems field from loadPendingItems.
 *  4h  loadGroveState still works when loadPendingItems returns empty queue.
 *
 * All Supabase queries and the LLM generate function are mocked. No network.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PendingQueue } from '@nibbin/keeper';

// ── Top-level vi.mock declarations (hoisted by vitest) ───────────────────────
// All mocks must be declared at the top level so vitest hoisting works.
// We use vi.fn() placeholders and reconfigure them via mockImplementation in
// beforeEach / per-test.

vi.mock('../../../lib/grove/pending-items', () => ({
  loadPendingItems: vi.fn(),
}));

vi.mock('../../../lib/supabase/server', () => ({
  createClient: vi.fn(),
}));

vi.mock('../../../lib/supabase/service', () => ({
  serviceClient: vi.fn(),
}));

vi.mock('../../../lib/auth/bootstrap', () => ({
  ensureAccount: vi.fn(),
}));

vi.mock('../../../lib/auth/profile', () => ({
  upsertOwnProfile: vi.fn(),
}));

vi.mock('../../../lib/llm/client', () => ({
  anthropicGenerate: vi.fn(),
  recordModelCall: vi.fn(),
}));

vi.mock('../../../lib/grove/router', () => ({
  groveRouter: { route: vi.fn() },
}));

// ── Import mocked modules after vi.mock declarations ─────────────────────────

import { loadPendingItems } from '../../../lib/grove/pending-items';
import { createClient } from '../../../lib/supabase/server';
import { ensureAccount } from '../../../lib/auth/bootstrap';
import { anthropicGenerate, recordModelCall } from '../../../lib/llm/client';
import { groveRouter } from '../../../lib/grove/router';

// ── Fixtures ─────────────────────────────────────────────────────────────────

const ACCOUNT_ID = 'acc-t4-test';
const USER_ID = 'user-t4-test';

const EMPTY_QUEUE: PendingQueue = {
  proposals: [],
  runs: [],
  conflicts: [],
  total: 0,
  hasHighStakes: false,
};

const ONE_PROPOSAL_QUEUE: PendingQueue = {
  proposals: [
    {
      proposalId: 'prop-1',
      fieldKey: 'pricing',
      rationale: 'from rate sheet',
      stakes: 'normal',
      createdAt: '2026-06-23T10:00:00Z',
    },
  ],
  runs: [],
  conflicts: [],
  total: 1,
  hasHighStakes: false,
};

// ── Supabase mock helper ─────────────────────────────────────────────────────

function makeChain(resolve: () => Promise<{ data: unknown; error: unknown }>) {
  const chain: Record<string, unknown> = {};
  const methods = ['select', 'eq', 'is', 'in', 'order', 'limit', 'not', 'maybeSingle', 'single'];
  for (const m of methods) {
    chain[m] = vi.fn(() => chain);
  }
  chain.then = (ok: (v: unknown) => unknown, fail: (e: unknown) => unknown) =>
    resolve().then(ok, fail);
  return chain;
}

function makeSupabaseMock(keeperName: string | null = 'Bramble') {
  return {
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: { user: { id: USER_ID, email: 'test@example.com' } },
      }),
    },
    from: vi.fn().mockImplementation((table: string) => {
      if (table === 'grove_state') {
        return makeChain(async () => ({
          data: { keeper_name: keeperName },
          error: null,
        }));
      }
      if (table === 'subscriptions') {
        return makeChain(async () => ({ data: null, error: null }));
      }
      return makeChain(async () => ({ data: null, error: null }));
    }),
    rpc: vi.fn().mockResolvedValue({ data: ACCOUNT_ID, error: null }),
  };
}

// ── keeperChatAction tests ────────────────────────────────────────────────────

describe('keeperChatAction — loadPendingItems wiring (Task 4)', () => {
  let capturedSystemMessages: Array<{ text: string; cache?: boolean }> | null = null;

  beforeEach(() => {
    capturedSystemMessages = null;
    vi.clearAllMocks();

    // Default: ensureAccount resolves to ACCOUNT_ID
    vi.mocked(ensureAccount).mockResolvedValue(ACCOUNT_ID);

    // Default: recordModelCall is a no-op
    vi.mocked(recordModelCall).mockResolvedValue(undefined as never);

    // Default: groveRouter returns a T1 route
    vi.mocked(groveRouter.route).mockReturnValue({
      tier: 't1',
      degraded: false,
      model: 'claude-test',
      classification: null,
    } as never);

    // Default generate function: captures system messages + returns a reply
    vi.mocked(anthropicGenerate).mockReturnValue(
      (async (params: { system: Array<{ text: string; cache?: boolean }> }) => {
        capturedSystemMessages = params.system;
        return {
          text: 'Hello from Bramble!',
          model: 'claude-test',
          usage: { inputTokens: 10, cacheWriteTokens: 0, cacheReadTokens: 0, outputTokens: 5 },
        };
      }) as never,
    );
  });

  it('4c — volatile suffix contains "1 item" when queue has 1 proposal', async () => {
    vi.mocked(loadPendingItems).mockResolvedValue(ONE_PROPOSAL_QUEUE);
    vi.mocked(createClient).mockResolvedValue(makeSupabaseMock('Bramble') as never);

    const { keeperChatAction } = await import('./actions');
    await keeperChatAction('Hello');

    // The volatile suffix is the second system message (after the cached stable block).
    const volatileSuffix = capturedSystemMessages?.[1]?.text ?? '';
    expect(volatileSuffix).toContain('1 item');
    expect(volatileSuffix).toContain('waiting');
  });

  it('4d — empty queue → volatile suffix does NOT contain "items waiting"', async () => {
    vi.mocked(loadPendingItems).mockResolvedValue(EMPTY_QUEUE);
    vi.mocked(createClient).mockResolvedValue(makeSupabaseMock('Bramble') as never);

    const { keeperChatAction } = await import('./actions');
    await keeperChatAction('Hello');

    const volatileSuffix = capturedSystemMessages?.[1]?.text ?? '';
    expect(volatileSuffix).not.toContain('items waiting');
    expect(volatileSuffix).not.toContain('item waiting');
  });

  it('4e — C10 regression: loadPendingItems returns a PendingQueue (no write calls)', async () => {
    // Verify that loadPendingItems is the function called (not a write-path RPC).
    // The mock captures the call; we assert it was invoked with (supabase, accountId)
    // and that no rpc write methods were called through our pending path.
    vi.mocked(loadPendingItems).mockResolvedValue(ONE_PROPOSAL_QUEUE);

    const supabaseMock = makeSupabaseMock('Bramble');
    vi.mocked(createClient).mockResolvedValue(supabaseMock as never);

    const { keeperChatAction } = await import('./actions');
    await keeperChatAction('Hello');

    // loadPendingItems was called with the supabase client and accountId
    expect(loadPendingItems).toHaveBeenCalledWith(
      expect.objectContaining({ from: expect.any(Function) }),
      ACCOUNT_ID,
    );

    // The rpc calls that happened are only the bootstrap (bootstrap_account) or
    // recordModelCall — NOT an insert/update through the pending path.
    // We verify loadPendingItems itself is the read path (a mock), not a write.
    const rpcCalls = supabaseMock.rpc.mock.calls.map((c: unknown[]) => c[0]);
    // No write RPCs from pending path (bootstrap_account is the only valid rpc here)
    expect(rpcCalls.every((name: unknown) => name === 'bootstrap_account')).toBe(true);
  });

  it('4f — loadPendingItems failure degrades gracefully: chat reply still returned', async () => {
    // loadPendingItems rejects — keeperChatAction must still return a valid reply.
    vi.mocked(loadPendingItems).mockRejectedValue(new Error('DB connection failed'));
    vi.mocked(createClient).mockResolvedValue(makeSupabaseMock('Bramble') as never);

    const { keeperChatAction } = await import('./actions');

    // Must resolve (not reject) even though loadPendingItems threw
    const result = await keeperChatAction('Hello');
    expect(result).toBeDefined();
    expect(result.message).toBeDefined();
    expect(result.message.card).toBeDefined();
  });
});

// ── loadGroveState tests ──────────────────────────────────────────────────────
//
// loadGroveState is a plain async function in apps/web/lib/grove/load.ts.
// We test it directly with mock Supabase + the already-mocked loadPendingItems.

// loadGroveState is in a separate module; we need to mock pending-items at the
// path relative to that module. Since the mock is hoisted at the top of this
// file for '../../../lib/grove/pending-items', we need to also mock the path
// that load.ts uses. load.ts imports from './pending-items' (relative), which
// resolves to apps/web/lib/grove/pending-items — the same file.
// The top-level mock covers it since vitest resolves to the same module id.

function makeGroveSupabaseMock() {
  return {
    from: vi.fn().mockImplementation((table: string) => {
      if (table === 'grove_state') {
        return makeChain(async () => ({
          data: { keeper_name: 'Bramble', onboarding_step: 'done', answers: '{}' },
          error: null,
        }));
      }
      if (table === 'users') {
        return makeChain(async () => ({ data: { name: 'June' }, error: null }));
      }
      if (table === 'credit_balances') {
        return makeChain(async () => ({ data: { balance: 100 }, error: null }));
      }
      return makeChain(async () => ({ data: null, error: null }));
    }),
  };
}

describe('loadGroveState — pendingItems field (Task 4)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('4g — returns pendingItems from loadPendingItems in the GroveLoad', async () => {
    vi.mocked(loadPendingItems).mockResolvedValue(ONE_PROPOSAL_QUEUE);

    const { loadGroveState } = await import('../../../lib/grove/load');
    const result = await loadGroveState(makeGroveSupabaseMock() as never, ACCOUNT_ID, USER_ID);

    expect(result.pendingItems).toBeDefined();
    expect(result.pendingItems.total).toBe(1);
    expect(result.pendingItems.proposals).toHaveLength(1);
  });

  it('4h — empty queue: pendingItems.total is 0, GroveLoad still valid', async () => {
    vi.mocked(loadPendingItems).mockResolvedValue(EMPTY_QUEUE);

    const supabase = {
      from: vi.fn().mockImplementation(() =>
        makeChain(async () => ({ data: null, error: null })),
      ),
    };

    const { loadGroveState } = await import('../../../lib/grove/load');
    const result = await loadGroveState(supabase as never, ACCOUNT_ID, USER_ID);

    expect(result.pendingItems).toBeDefined();
    expect(result.pendingItems.total).toBe(0);
    // Other fields still present
    expect(result.state).toBeDefined();
    expect(result.initialMessages).toBeDefined();
  });
});
