/**
 * Minimal Voyage embeddings client (agent memory, §12A). Fetch-based — no SDK —
 * mirroring the Anthropic client's shape: a factory returning a typed fn.
 *
 * Used only to embed ALREADY-REDACTED derived memory text (facts / preferences /
 * entities), never raw content. One vector per input, order-preserved. Throws on
 * non-2xx so callers can treat embedding as best-effort (the web wrapper swallows
 * the error and stores the entry without an embedding — it still retrieves via
 * full-text + recency).
 *
 * `voyage-3` is 1024-dim, matching the `embedding vector(1024)` column.
 */
export interface VoyageOptions {
  apiKey: string;
  model?: string;
  /** Abort/timeout control; defaults to 15s. */
  timeoutMs?: number;
}

export type VoyageInputType = 'document' | 'query';

/** Embed a batch of texts. `inputType` distinguishes corpus ('document') from
 *  search ('query') — Voyage encodes each side for asymmetric retrieval. */
export type Embed = (texts: string[], inputType?: VoyageInputType) => Promise<number[][]>;

interface VoyageResponse {
  data?: Array<{ index: number; embedding: number[] }>;
}

export function createVoyageEmbedder(opts: VoyageOptions): Embed {
  const apiKey = opts.apiKey?.trim();
  if (!apiKey) throw new Error('voyage client: apiKey is required');
  const model = opts.model ?? 'voyage-3';
  const timeoutMs = opts.timeoutMs ?? 15_000;

  return async function embed(texts: string[], inputType: VoyageInputType = 'document'): Promise<number[][]> {
    if (texts.length === 0) return [];
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch('https://api.voyageai.com/v1/embeddings', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({ model, input: texts, input_type: inputType }),
        signal: ctrl.signal,
      });
      if (!res.ok) throw new Error(`voyage ${res.status}: ${await res.text().catch(() => '')}`);
      const json = (await res.json()) as VoyageResponse;
      // Re-order defensively by `index` so output aligns to input order.
      const out: number[][] = new Array(texts.length);
      for (const d of json.data ?? []) out[d.index] = d.embedding;
      return out;
    } finally {
      clearTimeout(t);
    }
  };
}
