/**
 * Grovekeeper synthesis system prompt (P5 §3.3).
 *
 * Two exports:
 *
 * - SYNTHESIS_SYSTEM_PROMPT — the STABLE, cacheable system block. Identical
 *   bytes for every account and every question. Flag `cache: true` when
 *   passing to Generate so the prefix is paid once, not per call. Never add
 *   per-account or per-question content here; that goes in the volatile suffix
 *   produced by buildSynthesisInput.
 *
 * - buildSynthesisInput — assembles the volatile user-message: the ranked
 *   passages (with citation anchors) followed by the question. Paid per call.
 *
 * Output schema (JSON mode):
 *   { summary, answer, citations, hasGap, gapNote }
 *   Each citation: { passageIndex, label, kind, sourceId?, excerpt }
 *
 * Citation anchors: each passage is numbered [N] (zero-based). The engine maps
 * citation.passageIndex → SynthesisPassage to recover source_id / source_title.
 */

/**
 * Stable, cacheable system prompt. Do NOT mutate; every byte change busts the
 * cache and is treated as a prompt change (requires eval gate sign-off).
 */
export const SYNTHESIS_SYSTEM_PROMPT = `You are the Grovekeeper's knowledge engine. Your job is to answer a user's question using only the passages provided below. You may not use any knowledge that is not in the provided passages.

Rules:
1. Answer from the passages only. If a claim appears in no passage, do not make it.
2. Cite every claim: after each sentence that draws on a passage, append [N] where N is the passage's index in the list (zero-based).
3. Keep the answer between 80 and 300 words.
4. Write a summary of 1–2 sentences (≤ 60 words) — a condensed headline of the answer.
5. Set hasGap to true if the passages do not fully answer the question, and write one sentence in gapNote describing what is missing. Set hasGap to false and gapNote to null if the passages cover the question adequately.
6. Do not mention that you are an AI. Do not break character. Answer warmly, plainly, sentence case.

Output: respond ONLY with a JSON object (no markdown fences, no preamble) matching this schema exactly:
{
  "summary": "<1–2 sentence condensed answer, ≤60 words>",
  "answer": "<cited prose, 80–300 words>",
  "citations": [
    {
      "passageIndex": <integer, 0-based index of the passage cited>,
      "label": "<doc title or memory provenance tag>",
      "kind": "memory" | "source",
      "sourceId": "<uuid or null>",
      "excerpt": "<verbatim snippet from the passage, ≤200 chars>"
    }
  ],
  "hasGap": <boolean>,
  "gapNote": "<one sentence or null>"
}`;

/**
 * One ranked passage to include in the synthesis user message.
 *
 * Fields:
 * - index     — zero-based citation anchor; the model writes [N] for this passage.
 * - kind      — 'memory' (from memory_entries) or 'source' (from source_chunks).
 * - label     — human-readable name shown in citations (source title / provenance tag).
 * - sourceId  — present when kind === 'source'; lets the engine map back to the row.
 * - text      — the passage text (already redaction-passed by the retrieval layer).
 */
export interface SynthesisPassage {
  index: number;
  kind: 'memory' | 'source';
  label: string;
  sourceId?: string;
  text: string;
}

/**
 * Build the volatile user-message suffix: numbered passages + question.
 *
 * The [N] anchor in each passage header is the citation key the model uses.
 * The engine maps citation.passageIndex back to SynthesisPassage[N] to
 * recover source_id, source_title, and score for the SynthesisResult.
 *
 * @param question  The user's original question (already length-capped by the caller).
 * @param passages  Ranked list produced by the retrieval layer, ordered best-first.
 * @returns         A plain string ready to pass as the user-message content.
 */
export function buildSynthesisInput(question: string, passages: SynthesisPassage[]): string {
  if (passages.length === 0) {
    return `Passages:\n\n(none)\n\nQuestion: ${question}`;
  }
  const passageBlock = passages
    .map((p) => `[${p.index}] (${p.kind}) ${p.label}\n${p.text}`)
    .join('\n\n');
  return `Passages:\n\n${passageBlock}\n\nQuestion: ${question}`;
}
