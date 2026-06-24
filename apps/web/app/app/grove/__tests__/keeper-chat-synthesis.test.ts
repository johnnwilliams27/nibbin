/**
 * T7a — Integration tests for keeperChatAction synthesis path.
 *
 * Verifies:
 * 1. A knowledge_lookup-classified message routes to the synthesis engine and
 *    returns a SynthesisCard (not a normal chat reply).
 * 2. A normal message does NOT invoke the synthesis engine.
 * 3. The budget draw (frontier_budget_take via keeperChat) is called exactly
 *    once per turn regardless of synthesis path (D18 constraint).
 * 4. A budget-exhausted (paused) turn falls through to the normal reply without
 *    invoking the synthesis engine.
 * 5. When synthesize() throws, the action gracefully falls through to normal
 *    keeperChat reply.
 * 6. The returned routing payload is correct for a synthesis turn.
 *
 * Mocking strategy:
 * - groveSession is mocked (no Supabase auth)
 * - supabase queries (grove_state, subscriptions, nibbins) are mocked per-test
 * - keeperChat is mocked to return controlled RouteDecision + message
 * - synthesize is mocked (no engine, no DB, no LLM)
 * - anthropicGenerate, recordModelCall are mocked
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { KeeperChatReply } from '@nibbin/keeper';

// ── Module mocks (hoisted) ────────────────────────────────────────────────────

// Mock 'server-only' is already aliased in vitest.config.ts → tests/server-only-stub.ts

vi.mock('../../../../lib/supabase/server', () => ({
  createClient: vi.fn(),
}));

vi.mock('../../../../lib/auth/bootstrap', () => ({
  ensureAccount: vi.fn(async () => 'acct-test-1'),
}));

vi.mock('../../../../lib/auth/profile', () => ({
  upsertOwnProfile: vi.fn(async () => {}),
}));

vi.mock('../../../../lib/llm/client', () => ({
  anthropicGenerate: vi.fn(() => null),
  recordModelCall: vi.fn(async () => {}),
}));

vi.mock('../../../../lib/grove/router', () => ({
  groveRouter: { route: vi.fn() },
}));

vi.mock('@nibbin/keeper', async () => {
  const actual = await vi.importActual<typeof import('@nibbin/keeper')>('@nibbin/keeper');
  return {
    ...actual,
    keeperChat: vi.fn(),
  };
});

vi.mock('../../../../lib/synthesis/engine', () => ({
  synthesize: vi.fn(),
}));

// ── Import under test (after mocks) ─────────────────────────────────────────

import { keeperChatAction } from '../actions';
import { keeperChat } from '@nibbin/keeper';
import { synthesize } from '../../../../lib/synthesis/engine';
import { createClient } from '../../../../lib/supabase/server';
import { anthropicGenerate, recordModelCall } from '../../../../lib/llm/client';

// ── Helpers ──────────────────────────────────────────────────────────────────

const mockKeeperChat = vi.mocked(keeperChat);
const mockSynthesize = vi.mocked(synthesize);
const mockCreateClient = vi.mocked(createClient);
const mockAnthropicGenerate = vi.mocked(anthropicGenerate);
// recordModelCall is mocked to prevent side effects; referenced for type-checking only
vi.mocked(recordModelCall);

/** A KeeperChatReply with a knowledge_lookup signal in classification. */
function makeKnowledgeLookupReply(): KeeperChatReply {
  return {
    message: {
      id: 'c-1',
      from: 'keeper',
      card: { kind: 'prose', text: 'Let me look that up.', transcript: 'Let me look that up.' },
    },
    decision: {
      tier: 't1',
      model: 'claude-haiku-4-5',
      requestedTier: 't1',
      degraded: false,
      notice: null,
      classification: {
        tier: 't1',
        score: 0.4,
        signals: ['knowledge_lookup'],
      },
    },
    expression: 'presenting',
    dispatchedTier: 't1',
    dispatchedModel: 'claude-haiku-4-5',
    dispatchedDegraded: false,
  };
}

/** A KeeperChatReply with NO knowledge_lookup signal. */
function makeNormalReply(): KeeperChatReply {
  return {
    message: {
      id: 'c-2',
      from: 'keeper',
      card: { kind: 'prose', text: 'Hello! How can I help?', transcript: 'Hello! How can I help?' },
    },
    decision: {
      tier: 't0',
      model: 'scripted-floor',
      requestedTier: 't0',
      degraded: false,
      notice: null,
      classification: {
        tier: 't0',
        score: 0.1,
        signals: ['smalltalk'],
      },
    },
    expression: 'presenting',
    dispatchedTier: null,
    dispatchedModel: null,
    dispatchedDegraded: false,
  };
}

/** A KeeperChatReply where budget was exhausted (paused). */
function makePausedReply(): KeeperChatReply {
  return {
    message: {
      id: 'c-3',
      from: 'keeper',
      card: { kind: 'prose', text: 'You have reached your daily chat limit.', transcript: 'You have reached your daily chat limit.' },
    },
    decision: {
      tier: 't0',
      model: 'scripted-floor',
      requestedTier: 't0',
      degraded: false,
      notice: "You've reached today's chat limit.",
      paused: true,
      budget: { used: 20, limit: 20, remaining: 0, dayKey: '2026-06-23' },
      classification: {
        tier: 't1',
        score: 0.4,
        signals: ['knowledge_lookup'],
      },
    },
    expression: 'presenting',
    dispatchedTier: null,
    dispatchedModel: null,
    dispatchedDegraded: false,
  };
}

/** Mock Supabase client for grove_state + subscriptions + nibbins lookups. */
function makeSupabaseMock(opts: {
  keeperName?: string | null;
  tier?: string | null;
  nibbinId?: string | null;
} = {}) {
  const { keeperName = 'Keeper', tier = 'hatchling', nibbinId = 'nibbin-keeper-1' } = opts;

  const buildChain = (result: unknown) => {
    const chain: Record<string, unknown> = {};
    const end = { maybeSingle: vi.fn(async () => result) };
    chain.select = vi.fn(() => chain);
    chain.eq = vi.fn(() => ({ ...chain, ...end }));
    chain.maybeSingle = end.maybeSingle;
    return chain;
  };

  const groveChain = buildChain({ data: { keeper_name: keeperName }, error: null });
  const subChain = buildChain({ data: tier ? { tier } : null, error: null });
  const nibbinsData = nibbinId ? [{ id: nibbinId }] : [];
  // nibbins returns an array via .select().eq().eq()
  const nibbinsChain: Record<string, unknown> = {};
  nibbinsChain.select = vi.fn(() => nibbinsChain);
  nibbinsChain.eq = vi.fn(() => nibbinsChain);
  // The last .eq() in the nibbins query returns a thenable (no .maybeSingle)
  // but the action uses await svc.from('nibbins')... which needs data+error.
  const nibbinsResult = { data: nibbinsData, error: null };
  // Override the last .eq to return the result directly
  nibbinsChain.eq = vi.fn().mockImplementation((col: string) => {
    if (col === 'kind') {
      return { data: nibbinsData, error: null, then: (r: (v: unknown) => unknown) => Promise.resolve(r(nibbinsResult)) };
    }
    return nibbinsChain;
  });

  const fromMap: Record<string, unknown> = {
    grove_state: groveChain,
    subscriptions: subChain,
    nibbins: nibbinsChain,
  };

  return {
    auth: {
      getUser: vi.fn(async () => ({ data: { user: { id: 'user-test-1', email: 'test@example.com' } } })),
    },
    from: vi.fn((table: string) => fromMap[table] ?? buildChain({ data: null, error: null })),
    rpc: vi.fn(async () => ({ data: null, error: null })),
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('keeperChatAction — synthesis integration (T7)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: anthropicGenerate returns a generate function (so keeperChat
    // will actually route + call it). The action checks `if (llm)` before
    // calling synthesize, so we need a non-null LLM.
    mockAnthropicGenerate.mockReturnValue(vi.fn(async () => null) as unknown as ReturnType<typeof anthropicGenerate>);
  });

  it('calls synthesize when classification.signals includes knowledge_lookup', async () => {
    const supabase = makeSupabaseMock();
    mockCreateClient.mockResolvedValue(supabase as unknown as Awaited<ReturnType<typeof createClient>>);
    mockKeeperChat.mockResolvedValue(makeKnowledgeLookupReply());
    mockSynthesize.mockResolvedValue({
      summary: 'You charge 50% upfront.',
      answer: 'Based on your notes, you charge a 50% deposit upfront on all projects. [0]',
      citations: [{ label: 'deposit policy', kind: 'memory', excerpt: '50% deposit upfront', score: 0.85 }],
      gapNote: null,
      corpusCounts: { memory: 1, sources: 0 },
    });

    const result = await keeperChatAction('What do I charge for portraits?');

    expect(mockSynthesize).toHaveBeenCalledOnce();
    expect(result.message.card.kind).toBe('synthesis');
  });

  it('returns SynthesisCard message when synthesize succeeds', async () => {
    const supabase = makeSupabaseMock();
    mockCreateClient.mockResolvedValue(supabase as unknown as Awaited<ReturnType<typeof createClient>>);
    mockKeeperChat.mockResolvedValue(makeKnowledgeLookupReply());
    mockSynthesize.mockResolvedValue({
      summary: 'You charge 50% upfront.',
      answer: 'Based on your notes, you charge a 50% deposit upfront. [0]',
      citations: [{ label: 'deposit policy', kind: 'memory', excerpt: '50% deposit upfront', score: 0.85 }],
      gapNote: null,
      corpusCounts: { memory: 1, sources: 0 },
    });

    const result = await keeperChatAction('What do I charge for portraits?');

    expect(result.message.card.kind).toBe('synthesis');
    const card = result.message.card;
    if (card.kind !== 'synthesis') throw new Error('expected synthesis card');
    expect(card.summary).toBe('You charge 50% upfront.');
    expect(card.fullAnswer).toContain('50% deposit');
    expect(card.citations).toHaveLength(1);
    expect(card.gapNote).toBeNull();
    expect(card.corpusCounts).toEqual({ memory: 1, sources: 0 });
    // transcript must equal fullAnswer (a11y parity §4.2)
    expect(card.transcript).toBe(card.fullAnswer);
  });

  it('falls through to normal keeperChat reply when synthesis throws', async () => {
    const supabase = makeSupabaseMock();
    mockCreateClient.mockResolvedValue(supabase as unknown as Awaited<ReturnType<typeof createClient>>);
    mockKeeperChat.mockResolvedValue(makeKnowledgeLookupReply());
    mockSynthesize.mockRejectedValue(new Error('synthesis exploded'));

    const result = await keeperChatAction('What do I charge for portraits?');

    // Falls through to the normal keeperChat reply (prose card)
    expect(result.message.card.kind).toBe('prose');
    expect(mockSynthesize).toHaveBeenCalledOnce();
  });

  it('does NOT call synthesize when question is not knowledge_lookup', async () => {
    const supabase = makeSupabaseMock();
    mockCreateClient.mockResolvedValue(supabase as unknown as Awaited<ReturnType<typeof createClient>>);
    mockKeeperChat.mockResolvedValue(makeNormalReply());

    const result = await keeperChatAction('Hey how are you?');

    expect(mockSynthesize).not.toHaveBeenCalled();
    expect(result.message.card.kind).toBe('prose');
  });

  it('does NOT call synthesize when budget is exhausted (paused turn)', async () => {
    const supabase = makeSupabaseMock();
    mockCreateClient.mockResolvedValue(supabase as unknown as Awaited<ReturnType<typeof createClient>>);
    // paused reply has knowledge_lookup signal but decision.paused = true
    mockKeeperChat.mockResolvedValue(makePausedReply());

    const result = await keeperChatAction('What do I charge for portraits?');

    // Should NOT call synthesis — budget exhausted
    expect(mockSynthesize).not.toHaveBeenCalled();
    // Returns the paused reply from keeperChat
    expect(result.message.card.kind).toBe('prose');
  });

  it('budget draw (keeperChat) is called exactly once per turn on the synthesis path', async () => {
    const supabase = makeSupabaseMock();
    mockCreateClient.mockResolvedValue(supabase as unknown as Awaited<ReturnType<typeof createClient>>);
    mockKeeperChat.mockResolvedValue(makeKnowledgeLookupReply());
    mockSynthesize.mockResolvedValue({
      summary: 'You charge 50% upfront.',
      answer: 'You charge a 50% deposit. [0]',
      citations: [],
      gapNote: null,
      corpusCounts: { memory: 1, sources: 0 },
    });

    await keeperChatAction('What do I charge?');

    // keeperChat must be called exactly once — the unified budget tally is inside it
    expect(mockKeeperChat).toHaveBeenCalledOnce();
    // No second keeperChat call for the synthesis path
    expect(mockKeeperChat).toHaveBeenCalledTimes(1);
  });

  it('budget draw is called exactly once per turn on the normal (non-synthesis) path', async () => {
    const supabase = makeSupabaseMock();
    mockCreateClient.mockResolvedValue(supabase as unknown as Awaited<ReturnType<typeof createClient>>);
    mockKeeperChat.mockResolvedValue(makeNormalReply());

    await keeperChatAction('How are you?');

    expect(mockKeeperChat).toHaveBeenCalledTimes(1);
    expect(mockSynthesize).not.toHaveBeenCalled();
  });

  it('routing payload is returned correctly for a synthesis turn', async () => {
    const supabase = makeSupabaseMock();
    mockCreateClient.mockResolvedValue(supabase as unknown as Awaited<ReturnType<typeof createClient>>);
    mockKeeperChat.mockResolvedValue(makeKnowledgeLookupReply());
    mockSynthesize.mockResolvedValue({
      summary: 'Summary here.',
      answer: 'Full answer here.',
      citations: [],
      gapNote: null,
      corpusCounts: { memory: 0, sources: 0 },
    });

    const result = await keeperChatAction('What do I charge?');

    // Routing should reflect the decision from keeperChat (t1, not degraded)
    expect(result.routing).toEqual({
      tier: 't1',
      degraded: false,
      complexity: 0.4,
    });
  });

  it('synthesize receives the correct accountId, question, and userId', async () => {
    const supabase = makeSupabaseMock({ nibbinId: 'nibbin-keeper-99' });
    mockCreateClient.mockResolvedValue(supabase as unknown as Awaited<ReturnType<typeof createClient>>);
    mockKeeperChat.mockResolvedValue(makeKnowledgeLookupReply());
    mockSynthesize.mockResolvedValue({
      summary: 'Summary.',
      answer: 'Answer.',
      citations: [],
      gapNote: null,
      corpusCounts: { memory: 0, sources: 0 },
    });

    await keeperChatAction('What are my standard payment terms?');

    expect(mockSynthesize).toHaveBeenCalledWith(
      expect.objectContaining({
        accountId: 'acct-test-1',
        question: 'What are my standard payment terms?',
        userId: 'user-test-1',
      }),
    );
  });
});
