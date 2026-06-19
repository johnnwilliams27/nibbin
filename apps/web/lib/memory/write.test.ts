/**
 * Unit tests for writeAgentMemory (Planner memory.write): the #135-stance
 * guarantees that matter for a durable, agent-initiated write —
 *   • derived-not-raw: redaction (the real isClean predicate) runs BEFORE any
 *     embed/store, and a row carrying PII / a person-name run is DROPPED;
 *   • per-account, trusted-code-owns-account/scope/source: the LLM-shaped args
 *     (text/kind/confidence) never set account_id/source/user — those are stamped
 *     here, and the inserted row is `source='agent'`;
 *   • dedup: a matching natural-key row is UPDATED (bump), not duplicated;
 *   • bounded/validated: an invalid kind and empty text are refused without a DB
 *     call; a 'user' write with no acting user is refused (scope-integrity);
 *   • best-effort: a thrown DB error returns {ok:false}, never propagates.
 * The Supabase service client and the Voyage embed wrapper are mocked (no DB, no
 * VOYAGE_API_KEY) — embedTexts returns null so the embedding-null path is taken.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const insert = vi.fn();
const updateEq = vi.fn();
const update = vi.fn(() => ({ eq: updateEq }));
const limit = vi.fn();

// A chainable select builder: every filter returns `this`; `limit` resolves.
function makeSelectChain() {
  const chain: Record<string, unknown> = {};
  for (const m of ['select', 'eq', 'ilike', 'is']) chain[m] = vi.fn(() => chain);
  chain.limit = limit;
  return chain;
}

const from = vi.fn(() => ({
  select: () => makeSelectChain().select(),
  insert,
  update,
}));

vi.mock('../supabase/service', () => ({ serviceClient: () => ({ from }) }));
vi.mock('../llm/embed', () => ({ embedTexts: vi.fn(async () => null) }));

import { writeAgentMemory } from './write';

beforeEach(() => {
  insert.mockReset().mockResolvedValue({ error: null });
  updateEq.mockReset().mockResolvedValue({ error: null });
  update.mockClear();
  limit.mockReset().mockResolvedValue({ data: [] }); // no dedup match by default
  from.mockClear();
});

describe('writeAgentMemory — validation (no DB call)', () => {
  it('refuses empty text', async () => {
    const res = await writeAgentMemory({ accountId: 'a', userId: 'u', text: '   ', kind: 'fact' });
    expect(res).toEqual({ ok: false, reason: expect.stringContaining('empty') });
    expect(from).not.toHaveBeenCalled();
  });

  it('refuses an invalid kind', async () => {
    const res = await writeAgentMemory({ accountId: 'a', userId: 'u', text: 'x', kind: 'thought' as never });
    expect(res.ok).toBe(false);
    expect(from).not.toHaveBeenCalled();
  });

  it('refuses a user-scoped write with no acting user (scope-integrity)', async () => {
    const res = await writeAgentMemory({ accountId: 'a', userId: '', text: 'prefers brevity', kind: 'preference', scope: 'user' });
    expect(res).toEqual({ ok: false, reason: expect.stringContaining('acting user') });
    expect(from).not.toHaveBeenCalled();
  });
});

describe('writeAgentMemory — derived-not-raw guard runs BEFORE persist', () => {
  it('drops text carrying structured PII (an email)', async () => {
    const res = await writeAgentMemory({ accountId: 'a', userId: 'u', text: 'email them at jane@example.com', kind: 'fact' });
    expect(res.ok).toBe(false);
    expect(insert).not.toHaveBeenCalled();
  });

  it('drops text with an unstructured person name', async () => {
    const res = await writeAgentMemory({ accountId: 'a', userId: 'u', text: 'the client Maria Sanchez likes bullets', kind: 'fact' });
    expect(res.ok).toBe(false);
    expect(insert).not.toHaveBeenCalled();
  });
});

describe('writeAgentMemory — clean write', () => {
  it('inserts a new row stamped source=agent, provenance=inferred, never LLM-set account/source', async () => {
    const res = await writeAgentMemory({ accountId: 'acct-1', userId: 'user-1', text: 'prefers a warm sign-off', kind: 'preference', confidence: 0.8 });
    expect(res).toMatchObject({ ok: true, status: 'created' });
    expect(insert).toHaveBeenCalledTimes(1);
    const row = insert.mock.calls[0][0];
    expect(row).toMatchObject({
      account_id: 'acct-1',
      scope: 'user',
      user_id: 'user-1',
      kind: 'preference',
      provenance: 'inferred',
      source: 'agent',
      confidence: 0.8,
      embedding: null,
    });
  });

  it('updates (bumps) an existing natural-key match instead of duplicating', async () => {
    limit.mockResolvedValue({ data: [{ id: 'row-9', confidence: 0.4 }] });
    const res = await writeAgentMemory({ accountId: 'acct-1', userId: 'user-1', text: 'prefers a warm sign-off', kind: 'preference', confidence: 0.9 });
    expect(res).toMatchObject({ ok: true, status: 'updated' });
    expect(insert).not.toHaveBeenCalled();
    expect(update).toHaveBeenCalledTimes(1);
    const patch = update.mock.calls[0][0];
    expect(patch).toMatchObject({ source: 'agent', confidence: 0.9 }); // keeps the higher
    expect(updateEq).toHaveBeenCalledWith('id', 'row-9');
  });

  it('is best-effort: a thrown DB error returns {ok:false}, never propagates', async () => {
    insert.mockRejectedValue(new Error('db down'));
    await expect(writeAgentMemory({ accountId: 'a', userId: 'u', text: 'prefers brevity', kind: 'preference' })).resolves.toMatchObject({ ok: false });
  });
});
