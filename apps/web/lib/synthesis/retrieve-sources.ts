import 'server-only';

/**
 * Source-corpus retrieval caller (P5 §3.1 / T3).
 *
 * Mirrors apps/web/lib/memory/retrieve.ts exactly — same service-role client,
 * same Voyage embed wrapper, same best-effort / never-throws contract.
 *
 * With no VOYAGE_API_KEY: embedQuery returns null → p_embedding is null →
 * match_sources ranks by FTS + recency only (the null-embedding path verified
 * in T2's RLS suite). Nothing requires the key.
 *
 * Redaction note: embedQuery only ever receives the caller-supplied query
 * string, which has already cleared upstream redaction checks before reaching
 * the synthesis engine (same constraint as the memory path in embed.ts).
 * Raw quarantined content is never passed here.
 */
import { serviceClient } from '../supabase/service';
import { embedQuery } from '../llm/embed';

export interface SourceChunkRow {
  chunk_id: string;
  source_id: string;
  source_title: string;
  source_tier: number;
  text: string;
  score: number;
}

/**
 * Best-effort: returns ranked source chunk rows, or [] on any failure.
 * With no VOYAGE_API_KEY: p_embedding is null, RPC ranks by FTS + recency only.
 */
export async function retrieveSourceChunks(
  accountId: string,
  query: string,
  limit = 6,
  minScore = 0.25,
): Promise<SourceChunkRow[]> {
  try {
    const svc = serviceClient();
    const vec = await embedQuery(query); // null if no key / failure
    // supabase-js can't reliably pass a JS number[] to a `vector` RPC param, so
    // match_sources takes p_embedding as TEXT and casts to vector inside. Format
    // the query vector as a Postgres vector literal (or pass null).
    const pEmbedding = vec ? `[${vec.join(',')}]` : null;
    const { data } = await svc.rpc('match_sources', {
      p_account: accountId,
      p_embedding: pEmbedding,
      p_query: query,
      p_limit: limit,
      p_min_score: minScore,
    });
    return (data ?? []) as SourceChunkRow[];
  } catch (err) {
    console.error(
      '[synthesis] retrieveSourceChunks failed (best-effort)',
      err instanceof Error ? err.message : err,
    );
    return [];
  }
}
