import 'server-only';

/**
 * Voyage embedding wrapper for agent memory (§12A) — mirrors anthropicGenerate's
 * cached/null pattern (client.ts). One embedder per process, keyed from
 * VOYAGE_API_KEY. When the key is absent (CI, a fresh dev checkout, or any env
 * before the controller sets it post-merge), voyageEmbed() returns null and
 * embedTexts/embedQuery return null — entries store with embedding = null and
 * retrieval ranks on full-text + recency alone. Nothing requires the key.
 *
 * Voyage only ever receives derived text the writer already cleared: each entry
 * passed the upstream sidecar redaction (it is distilled from already-sanitized
 * draft text), then the writer re-checked it here with applyBattery (regex
 * battery) + a deterministic NER name check and DROPPED anything that tripped a
 * rule, before calling this. This is a regex-battery + heuristic-NER guard, not
 * a guarantee of full PII removal — the load-bearing redaction is upstream.
 */
import { createVoyageEmbedder, type Embed } from '@nibbin/router';

const g = globalThis as typeof globalThis & { __nibbinEmbed?: Embed | null };

export function voyageEmbed(): Embed | null {
  if (g.__nibbinEmbed !== undefined) return g.__nibbinEmbed;
  const key = process.env.VOYAGE_API_KEY;
  g.__nibbinEmbed = key && key.trim() !== '' ? createVoyageEmbedder({ apiKey: key }) : null;
  return g.__nibbinEmbed;
}

/** Best-effort: returns vectors aligned to `texts` (corpus side), or null if no
 *  key / empty input / failure. */
export async function embedTexts(texts: string[]): Promise<number[][] | null> {
  const e = voyageEmbed();
  if (!e || texts.length === 0) return null;
  try {
    return await e(texts, 'document');
  } catch (err) {
    console.error('[memory] voyage embed failed', err instanceof Error ? err.message : err);
    return null;
  }
}

/** Best-effort query-side embedding (asymmetric retrieval), or null. */
export async function embedQuery(text: string): Promise<number[] | null> {
  const e = voyageEmbed();
  if (!e || !text || text.trim() === '') return null;
  try {
    const out = await e([text], 'query');
    return out[0] ?? null;
  } catch (err) {
    console.error('[memory] voyage query embed failed', err instanceof Error ? err.message : err);
    return null;
  }
}
