/**
 * Unit tests for retrieveMemoryBlock (§12A): block formatting, the empty → null
 * case, and best-effort isolation (a thrown error returns null, never propagates).
 * The Supabase service client and the Voyage embed wrapper are mocked so the test
 * needs no DB and no VOYAGE_API_KEY.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const rpc = vi.fn();
vi.mock('../supabase/service', () => ({
  serviceClient: () => ({ rpc }),
}));
// No key → embedQuery returns null (the FTS/recency path); match the real shape.
vi.mock('../llm/embed', () => ({
  embedQuery: vi.fn(async () => null),
}));

import { retrieveMemoryBlock } from './retrieve';

beforeEach(() => {
  rpc.mockReset();
});

describe('retrieveMemoryBlock', () => {
  it('formats rows into a provenance-marked block', async () => {
    rpc.mockResolvedValue({
      data: [
        { kind: 'preference', text: 'prefers a warm sign-off', provenance: 'observed' },
        { kind: 'fact', text: 'works in eastern time', provenance: 'inferred' },
      ],
    });
    const block = await retrieveMemoryBlock('acct', 'nib', 'how should I sign off');
    expect(block).toContain("What you've learned about this account");
    expect(block).toContain('- (observed) prefers a warm sign-off');
    expect(block).toContain('- (inferred) works in eastern time');
  });

  it('returns null when there are no rows', async () => {
    rpc.mockResolvedValue({ data: [] });
    expect(await retrieveMemoryBlock('acct', 'nib', 'q')).toBeNull();
  });

  it('returns null (never throws) when the RPC fails — best-effort isolation', async () => {
    rpc.mockRejectedValue(new Error('db down'));
    await expect(retrieveMemoryBlock('acct', 'nib', 'q')).resolves.toBeNull();
  });

  it('passes p_embedding = null to the RPC when there is no key', async () => {
    rpc.mockResolvedValue({ data: [] });
    await retrieveMemoryBlock('acct', 'nib', 'q');
    expect(rpc).toHaveBeenCalledWith('match_memory', expect.objectContaining({ p_embedding: null, p_account: 'acct', p_nibbin: 'nib' }));
  });
});
