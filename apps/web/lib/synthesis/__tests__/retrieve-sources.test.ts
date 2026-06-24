/**
 * Unit tests for retrieveSourceChunks (P5 T3).
 *
 * Mirrors the pattern of apps/web/lib/memory/retrieve.test.ts:
 *  - serviceClient and embedQuery are fully mocked (no DB, no VOYAGE_API_KEY).
 *  - Tests cover: vector path, no-key (null embedding) path, RPC error path,
 *    and the typed return-shape contract that the synthesis engine (T6) consumes.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const rpc = vi.fn();
vi.mock('../../supabase/service', () => ({
  serviceClient: () => ({ rpc }),
}));

// Hoist-safe: declare the mock inside the factory, then import + spy after.
vi.mock('../../llm/embed', () => ({
  embedQuery: vi.fn(async () => null),
}));

import { retrieveSourceChunks, type SourceChunkRow } from '../retrieve-sources';
import { embedQuery } from '../../llm/embed';

const mockEmbedQuery = vi.mocked(embedQuery);

beforeEach(() => {
  rpc.mockReset();
  mockEmbedQuery.mockReset();
  mockEmbedQuery.mockResolvedValue(null); // default: no-key path
});

describe('retrieveSourceChunks', () => {
  it('calls match_sources with a postgres vector literal when embedQuery returns a vector', async () => {
    const fakeVec = [0.1, 0.2, 0.3];
    mockEmbedQuery.mockResolvedValue(fakeVec);
    rpc.mockResolvedValue({ data: [] });

    await retrieveSourceChunks('acct-1', 'what do I charge for portraits');

    expect(rpc).toHaveBeenCalledWith(
      'match_sources',
      expect.objectContaining({
        p_account: 'acct-1',
        p_embedding: '[0.1,0.2,0.3]',
        p_query: 'what do I charge for portraits',
      }),
    );
  });

  it('calls match_sources with p_embedding=null when embedQuery returns null (no-key path)', async () => {
    mockEmbedQuery.mockResolvedValue(null);
    rpc.mockResolvedValue({ data: [] });

    await retrieveSourceChunks('acct-1', 'my policy on deposits');

    expect(rpc).toHaveBeenCalledWith(
      'match_sources',
      expect.objectContaining({
        p_account: 'acct-1',
        p_embedding: null,
        p_query: 'my policy on deposits',
      }),
    );
  });

  it('returns [] on RPC error — best-effort, never throws', async () => {
    mockEmbedQuery.mockResolvedValue(null);
    rpc.mockRejectedValue(new Error('db down'));

    const result = await retrieveSourceChunks('acct-1', 'q');

    expect(result).toEqual([]);
  });

  it('returns typed SourceChunkRow[] when RPC returns rows', async () => {
    mockEmbedQuery.mockResolvedValue(null);
    const rows: SourceChunkRow[] = [
      {
        chunk_id: 'chunk-uuid-1',
        source_id: 'src-uuid-1',
        source_title: 'Acme Contract',
        source_tier: 50,
        text: 'Net-30 payment terms apply.',
        score: 0.72,
      },
      {
        chunk_id: 'chunk-uuid-2',
        source_id: 'src-uuid-1',
        source_title: 'Acme Contract',
        source_tier: 50,
        text: '$5000/mo retainer.',
        score: 0.61,
      },
    ];
    rpc.mockResolvedValue({ data: rows });

    const result = await retrieveSourceChunks('acct-1', 'what are Acme payment terms');

    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject<SourceChunkRow>({
      chunk_id: 'chunk-uuid-1',
      source_id: 'src-uuid-1',
      source_title: 'Acme Contract',
      source_tier: 50,
      text: 'Net-30 payment terms apply.',
      score: 0.72,
    });
    expect(result[1]).toMatchObject<SourceChunkRow>({
      chunk_id: 'chunk-uuid-2',
      source_id: 'src-uuid-1',
      source_title: 'Acme Contract',
      source_tier: 50,
      text: '$5000/mo retainer.',
      score: 0.61,
    });
  });

  it('passes the limit and minScore params through to the RPC', async () => {
    mockEmbedQuery.mockResolvedValue(null);
    rpc.mockResolvedValue({ data: [] });

    await retrieveSourceChunks('acct-1', 'gap requery', 4, 0.45);

    expect(rpc).toHaveBeenCalledWith(
      'match_sources',
      expect.objectContaining({
        p_limit: 4,
        p_min_score: 0.45,
      }),
    );
  });

  it('uses default limit=6 and minScore=0.25 when not specified', async () => {
    mockEmbedQuery.mockResolvedValue(null);
    rpc.mockResolvedValue({ data: [] });

    await retrieveSourceChunks('acct-2', 'default params query');

    expect(rpc).toHaveBeenCalledWith(
      'match_sources',
      expect.objectContaining({
        p_limit: 6,
        p_min_score: 0.25,
      }),
    );
  });

  it('returns [] (never throws) when embedQuery itself throws', async () => {
    mockEmbedQuery.mockRejectedValue(new Error('voyage unreachable'));
    rpc.mockResolvedValue({ data: [] });

    const result = await retrieveSourceChunks('acct-1', 'q');

    expect(result).toEqual([]);
  });

  it('returns [] when RPC data is null (no rows, no error)', async () => {
    mockEmbedQuery.mockResolvedValue(null);
    rpc.mockResolvedValue({ data: null });

    const result = await retrieveSourceChunks('acct-1', 'q');

    expect(result).toEqual([]);
  });
});
