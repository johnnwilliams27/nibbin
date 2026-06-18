import 'server-only';

/**
 * Agent + user memory retriever (§12A): at draft time, fetch the top-N relevant
 * derived memories for THIS nibbin's agent memory ∪ the account's user memory,
 * hybrid-ranked (semantic cosine + full-text + recency) by the match_memory RPC.
 *
 * Best-effort throughout — any failure returns null and the draft proceeds
 * without a memory block (never blocks a draft). With no VOYAGE_API_KEY the
 * query embedding is null and ranking falls back to FTS + recency.
 */
import { serviceClient } from '../supabase/service';
import { embedQuery } from '../llm/embed';

interface MatchRow {
  kind: string;
  text: string;
  provenance: string;
}

/** Returns a formatted memory system-block for this nibbin+account, or null. */
export async function retrieveMemoryBlock(
  accountId: string,
  nibbinId: string,
  query: string,
): Promise<string | null> {
  try {
    const svc = serviceClient();
    const vec = await embedQuery(query); // null if no key / failure
    // supabase-js can't reliably pass a JS number[] to a `vector` RPC param, so
    // match_memory takes p_embedding as TEXT and casts to vector inside. Format
    // the query vector as a Postgres vector literal (or pass null).
    const pEmbedding = vec ? `[${vec.join(',')}]` : null;
    const { data } = await svc.rpc('match_memory', {
      p_account: accountId,
      p_nibbin: nibbinId,
      p_embedding: pEmbedding,
      p_query: query,
      p_limit: 8,
      p_min_confidence: 0.3,
    });
    const rows = (data ?? []) as MatchRow[];
    if (rows.length === 0) return null;
    const lines = rows.map((r) => `- (${r.provenance}) ${r.text}`).join('\n');
    return `What you've learned about this account (use as context; treat "inferred" items as tentative):\n${lines}`;
  } catch (err) {
    console.error('[memory] retrieve failed (best-effort)', err instanceof Error ? err.message : err);
    return null;
  }
}

/**
 * Resolve the run's nibbin + account, then retrieve its memory block. The
 * drafter only has runId + intent in scope; this does one cheap PK read for
 * (account_id, nibbin_id). Best-effort — null on any failure.
 */
export async function memoryBlockFor(runId: string, query: string): Promise<string | null> {
  try {
    const svc = serviceClient();
    const { data: run } = await svc.from('runs').select('account_id, nibbin_id').eq('id', runId).single();
    if (!run?.account_id || !run?.nibbin_id) return null;
    return await retrieveMemoryBlock(run.account_id as string, run.nibbin_id as string, query);
  } catch (err) {
    console.error('[memory] memoryBlockFor failed (best-effort)', err instanceof Error ? err.message : err);
    return null;
  }
}
