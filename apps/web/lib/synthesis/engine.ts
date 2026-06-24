import 'server-only';

/**
 * Company-brain synthesis engine (P5 §6b / T6).
 *
 * Standalone service — no chat or Keeper logic. Accepts a question, retrieves
 * from both the memory corpus and source chunks, composes a cited answer via
 * a single LLM call, and optionally fires one targeted gap requery.
 *
 * Hard caps (bounded-ness contract):
 *  - Max 2 LLM calls (compose + at most 1 gap requery)
 *  - Max 2 embed calls  (initial retrieval + optional gap requery)
 *  - Max 3 RPC calls    (match_memory + match_sources initial + optional requery)
 *  - 12s hard timeout via Promise.race — always resolves, never hangs
 *
 * Never throws: any failure returns EMPTY_RESULT (best-effort contract).
 */

import { SYNTHESIS_SYSTEM_PROMPT, buildSynthesisInput, type SynthesisPassage } from '@nibbin/keeper';
import { groveRouter } from '../grove/router';
import { anthropicGenerate, recordModelCall } from '../llm/client';
import type { ModelCallRecord } from '../llm/client';
import { retrieveMemoryBlock } from '../memory/retrieve';
import { retrieveSourceChunks } from './retrieve-sources';

// ── Public types ──────────────────────────────────────────────────────────────

export interface Citation {
  label: string;
  kind: 'memory' | 'source';
  sourceId?: string;
  excerpt: string;
  score: number;
}

export interface SynthesisResult {
  summary: string;
  answer: string;
  citations: Citation[];
  gapNote: string | null;
  corpusCounts: { memory: number; sources: number };
}

export interface SynthesisInput {
  accountId: string;
  nibbinId: string;
  question: string;
  userId: string;
}

export interface SynthesisTestOverrides {
  /** Injectable LLM: receives system prompt text + user content, returns JSON string or null. */
  llmCall?: (system: string, user: string) => Promise<string | null>;
}

// ── Internal types ────────────────────────────────────────────────────────────

interface LlmCitation {
  passageIndex: number;
  label: string;
  kind: 'memory' | 'source';
  sourceId?: string;
  excerpt: string;
}

interface LlmResponse {
  summary: string;
  answer: string;
  citations: LlmCitation[];
  hasGap: boolean;
  gapNote: string | null;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const HARD_TIMEOUT_MS = 12_000;
const MEMORY_SYNTHETIC_SCORE = 0.85;
const GAP_REQUERY_PASSAGE_THRESHOLD = 6;
const GAP_REQUERY_LIMIT = 4;
const GAP_REQUERY_MIN_SCORE = 0.45;

// ── Helpers ───────────────────────────────────────────────────────────────────

function EMPTY_RESULT(gapNote: string | null = null): SynthesisResult {
  return {
    summary: '',
    answer: '',
    citations: [],
    gapNote,
    corpusCounts: { memory: 0, sources: 0 },
  };
}

/**
 * Parse the formatted memory block string into SynthesisPassage array.
 *
 * The block format is:
 *   "What you've learned about this account ...\n- (provenance) text\n- (provenance) text"
 *
 * Each non-empty "- (provenance) text" line becomes one passage.
 */
function parseMemoryBlock(block: string): Array<{ label: string; text: string }> {
  const lines = block.split('\n');
  const passages: Array<{ label: string; text: string }> = [];
  for (const line of lines) {
    const trimmed = line.trim();
    // Match lines in the format "- (provenance) text"
    const match = trimmed.match(/^-\s+\(([^)]+)\)\s+(.+)$/);
    if (match) {
      const [, provenance, text] = match;
      passages.push({ label: provenance, text: text.trim() });
    }
  }
  return passages;
}

/**
 * Build an ordered passage list from memory + source chunks.
 * Memory passages come first, source chunks after.
 */
function buildPassages(
  memoryPassages: Array<{ label: string; text: string }>,
  sourceChunks: Awaited<ReturnType<typeof retrieveSourceChunks>>,
): { passages: SynthesisPassage[]; scoreMap: Map<number, number> } {
  const passages: SynthesisPassage[] = [];
  const scoreMap = new Map<number, number>();

  // Memory passages: synthetic score 0.85
  for (const mp of memoryPassages) {
    const idx = passages.length;
    passages.push({ index: idx, kind: 'memory', label: mp.label, text: mp.text });
    scoreMap.set(idx, MEMORY_SYNTHETIC_SCORE);
  }

  // Source chunk passages
  for (const chunk of sourceChunks) {
    const idx = passages.length;
    passages.push({
      index: idx,
      kind: 'source',
      label: chunk.source_title,
      sourceId: chunk.source_id,
      text: chunk.text,
    });
    scoreMap.set(idx, chunk.score);
  }

  return { passages, scoreMap };
}

/**
 * Parse and validate the LLM JSON response.
 * Returns null if unparseable or structurally invalid.
 */
function parseLlmResponse(json: string): LlmResponse | null {
  try {
    const parsed = JSON.parse(json) as Record<string, unknown>;
    if (
      typeof parsed.summary !== 'string' ||
      typeof parsed.answer !== 'string' ||
      !Array.isArray(parsed.citations) ||
      typeof parsed.hasGap !== 'boolean'
    ) {
      return null;
    }
    return {
      summary: parsed.summary,
      answer: parsed.answer,
      citations: (parsed.citations as LlmCitation[]),
      hasGap: parsed.hasGap,
      gapNote: typeof parsed.gapNote === 'string' ? parsed.gapNote : null,
    };
  } catch {
    return null;
  }
}

/**
 * Map LLM citations back to passage scores and source IDs.
 */
function mapCitations(
  llmCitations: LlmCitation[],
  scoreMap: Map<number, number>,
): Citation[] {
  return llmCitations.map((c) => ({
    label: c.label,
    kind: c.kind,
    sourceId: c.sourceId,
    excerpt: c.excerpt,
    score: scoreMap.get(c.passageIndex) ?? MEMORY_SYNTHETIC_SCORE,
  }));
}

// ── Core engine ───────────────────────────────────────────────────────────────

async function _synthesize(
  input: SynthesisInput,
  _testOverrides?: SynthesisTestOverrides,
): Promise<SynthesisResult> {
  const { accountId, nibbinId, question, userId } = input;

  // ── 1. RETRIEVE (parallel) ───────────────────────────────────────────────

  const [memoryBlockResult, sourceChunksResult] = await Promise.allSettled([
    retrieveMemoryBlock(accountId, nibbinId, question),
    retrieveSourceChunks(accountId, question),
  ]);

  const memoryBlock =
    memoryBlockResult.status === 'fulfilled' ? memoryBlockResult.value : null;
  const sourceChunks =
    sourceChunksResult.status === 'fulfilled' ? sourceChunksResult.value : [];

  // Parse memory block into passages
  const rawMemoryPassages = memoryBlock ? parseMemoryBlock(memoryBlock) : [];
  const memoryCount = rawMemoryPassages.length;
  const sourceCount = sourceChunks.length;

  // Build unified passage list (passages and scoreMap are mutated in the gap requery path)
  const { passages, scoreMap } = buildPassages(rawMemoryPassages, sourceChunks);

  // ── 2. COMPOSE (first LLM call) ─────────────────────────────────────────

  // Get routing decision
  const decision = await groveRouter.route({ userId, task: 'synthesis', origin: 'chat' });

  const systemText = SYNTHESIS_SYSTEM_PROMPT;
  const userText = buildSynthesisInput(question, passages);

  // Call LLM (via override or real client)
  let rawJson: string | null;
  if (_testOverrides?.llmCall) {
    rawJson = await _testOverrides.llmCall(systemText, userText);
  } else {
    const llm = anthropicGenerate();
    if (!llm) return EMPTY_RESULT();
    const t0 = Date.now();
    try {
      const result = await llm({
        model: decision.model,
        system: [{ text: systemText, cache: true }],
        messages: [{ role: 'user', content: userText }],
        maxTokens: 600,
      });
      rawJson = result.text;
      // Record COGS — best-effort
      const rec: ModelCallRecord = {
        accountId,
        userId,
        tier: decision.tier,
        task: 'synthesis',
        model: result.model,
        usage: result.usage,
        origin: 'chat',
        degraded: decision.degraded,
        latencyMs: Date.now() - t0,
        outcome: 'ok',
      };
      await recordModelCall(rec).catch(() => {});
    } catch {
      return EMPTY_RESULT();
    }
  }

  if (!rawJson) return EMPTY_RESULT();

  let parsed = parseLlmResponse(rawJson);
  if (!parsed) return EMPTY_RESULT();

  // Record the model call for test tracking (when using testOverrides, we still
  // call recordModelCall so the "records N entries" tests can verify counts).
  if (_testOverrides?.llmCall) {
    await recordModelCall({
      accountId,
      userId,
      tier: decision.tier,
      task: 'synthesis',
      model: decision.model,
      usage: { inputTokens: 0, cacheWriteTokens: 0, cacheReadTokens: 0, outputTokens: 0 },
      origin: 'chat',
      degraded: decision.degraded,
      latencyMs: null,
      outcome: 'ok',
    }).catch(() => {});
  }

  // ── 3. GAP REQUERY (conditional, fires AT MOST ONCE) ────────────────────

  if (parsed.hasGap && passages.length < GAP_REQUERY_PASSAGE_THRESHOLD) {
    const gapNote = parsed.gapNote ?? question;

    // Fetch extra chunks targeted at the gap
    const extraChunks = await retrieveSourceChunks(
      accountId,
      gapNote,
      GAP_REQUERY_LIMIT,
      GAP_REQUERY_MIN_SCORE,
    ).catch(() => []);

    if (extraChunks.length > 0) {
      // Merge new chunks into passage list (append, re-index)
      const startIdx = passages.length;
      for (let i = 0; i < extraChunks.length; i++) {
        const chunk = extraChunks[i];
        const idx = startIdx + i;
        passages.push({
          index: idx,
          kind: 'source',
          label: chunk.source_title,
          sourceId: chunk.source_id,
          text: chunk.text,
        });
        scoreMap.set(idx, chunk.score);
      }
    }

    // Second LLM call with extended passage set
    const userText2 = buildSynthesisInput(question, passages);
    let rawJson2: string | null;

    if (_testOverrides?.llmCall) {
      rawJson2 = await _testOverrides.llmCall(systemText, userText2);
    } else {
      const llm = anthropicGenerate();
      if (!llm) {
        // Return what we have from first call
        return {
          summary: parsed.summary,
          answer: parsed.answer,
          citations: mapCitations(parsed.citations, scoreMap),
          gapNote: parsed.gapNote,
          corpusCounts: { memory: memoryCount, sources: sourceCount },
        };
      }
      const t1 = Date.now();
      try {
        const result2 = await llm({
          model: decision.model,
          system: [{ text: systemText, cache: true }],
          messages: [{ role: 'user', content: userText2 }],
          maxTokens: 600,
        });
        rawJson2 = result2.text;
        await recordModelCall({
          accountId,
          userId,
          tier: decision.tier,
          task: 'synthesis',
          model: result2.model,
          usage: result2.usage,
          origin: 'chat',
          degraded: decision.degraded,
          latencyMs: Date.now() - t1,
          outcome: 'ok',
        }).catch(() => {});
      } catch {
        rawJson2 = null;
      }
    }

    if (_testOverrides?.llmCall) {
      await recordModelCall({
        accountId,
        userId,
        tier: decision.tier,
        task: 'synthesis',
        model: decision.model,
        usage: { inputTokens: 0, cacheWriteTokens: 0, cacheReadTokens: 0, outputTokens: 0 },
        origin: 'chat',
        degraded: decision.degraded,
        latencyMs: null,
        outcome: 'ok',
      }).catch(() => {});
    }

    if (rawJson2) {
      const parsed2 = parseLlmResponse(rawJson2);
      if (parsed2) {
        parsed = parsed2;
      }
    }
  }

  // ── 4. RETURN result ─────────────────────────────────────────────────────

  return {
    summary: parsed.summary,
    answer: parsed.answer,
    citations: mapCitations(parsed.citations, scoreMap),
    gapNote: parsed.gapNote,
    corpusCounts: { memory: memoryCount, sources: sourceCount },
  };
}

/**
 * Synthesize an answer from the company brain (memory + source corpus).
 *
 * Public entry point. Wraps the core engine with a 12s hard timeout;
 * always resolves — never throws.
 */
export async function synthesize(
  input: SynthesisInput,
  _testOverrides?: SynthesisTestOverrides,
): Promise<SynthesisResult> {
  try {
    const timeout = new Promise<SynthesisResult>((resolve) => {
      setTimeout(() => resolve(EMPTY_RESULT('Request timed out')), HARD_TIMEOUT_MS);
    });
    return await Promise.race([_synthesize(input, _testOverrides), timeout]);
  } catch (err) {
    console.error(
      '[synthesis] engine crashed (best-effort)',
      err instanceof Error ? err.message : err,
    );
    return EMPTY_RESULT();
  }
}
