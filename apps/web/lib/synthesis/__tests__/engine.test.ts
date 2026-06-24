/**
 * Unit tests for the synthesis engine (P5 §6b / T6).
 *
 * Mocking strategy:
 * - retrieveMemoryBlock and retrieveSourceChunks are fully mocked (no DB, no API).
 * - embedQuery is mocked (no VOYAGE_API_KEY).
 * - anthropicGenerate and recordModelCall are mocked (no ANTHROPIC_API_KEY).
 * - groveRouter is mocked to return a deterministic t1 decision.
 * - LLM calls are injected via _testOverrides.llmCall (JSON string → string | null).
 *
 * Hard caps enforced by the engine:
 *  - Max 2 LLM calls
 *  - Max 2 embed calls
 *  - Max 3 RPC calls
 *  - 12s hard timeout via Promise.race
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Module mocks (must be hoisted before imports) ────────────────────────────

vi.mock('../../memory/retrieve', () => ({
  retrieveMemoryBlock: vi.fn(),
}));

vi.mock('../retrieve-sources', () => ({
  retrieveSourceChunks: vi.fn(),
}));

vi.mock('../../llm/embed', () => ({
  embedQuery: vi.fn(),
}));

vi.mock('../../supabase/service', () => ({
  serviceClient: () => ({
    from: () => ({
      insert: vi.fn(async () => ({ error: null })),
    }),
  }),
}));

vi.mock('../../llm/client', () => ({
  anthropicGenerate: vi.fn(() => null),
  recordModelCall: vi.fn(async () => {}),
}));

vi.mock('../../grove/router', () => ({
  groveRouter: {
    route: vi.fn(async () => ({
      tier: 't1',
      model: 'claude-haiku-4-5',
      requestedTier: 't1',
      degraded: false,
      notice: null,
    })),
  },
}));

// ── Import under test (after mocks) ─────────────────────────────────────────

import { synthesize, type SynthesisInput } from '../engine';
import { retrieveMemoryBlock } from '../../memory/retrieve';
import { retrieveSourceChunks } from '../retrieve-sources';
import { embedQuery } from '../../llm/embed';
import { recordModelCall } from '../../llm/client';

// ── Helpers ──────────────────────────────────────────────────────────────────

const mockRetrieveMemory = vi.mocked(retrieveMemoryBlock);
const mockRetrieveSources = vi.mocked(retrieveSourceChunks);
const mockEmbedQuery = vi.mocked(embedQuery);
const mockRecordModelCall = vi.mocked(recordModelCall);

const BASE_INPUT: SynthesisInput = {
  accountId: 'acct-test-1',
  nibbinId: 'nibbin-test-1',
  question: 'What are my standard payment terms?',
  userId: 'user-test-1',
};

/** A minimal valid LLM JSON response with one citation. */
function okLlmResponse(overrides: Partial<{
  summary: string;
  answer: string;
  hasGap: boolean;
  gapNote: string | null;
}> = {}): string {
  return JSON.stringify({
    summary: overrides.summary ?? 'Payment terms are net-30.',
    answer: overrides.answer ?? 'Based on the Acme contract, payment terms are net-30. [0]',
    citations: [
      {
        passageIndex: 0,
        label: 'Acme Contract',
        kind: 'source',
        sourceId: 'src-uuid-1',
        excerpt: 'Net-30 payment terms apply.',
      },
    ],
    hasGap: overrides.hasGap ?? false,
    gapNote: overrides.gapNote ?? null,
  });
}

/** A valid source chunk row for testing. */
function sourceChunk(n = 1) {
  return {
    chunk_id: `chunk-${n}`,
    source_id: `src-uuid-${n}`,
    source_title: 'Acme Contract',
    source_tier: 50,
    text: 'Net-30 payment terms apply.',
    score: 0.72,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockEmbedQuery.mockResolvedValue(null);
});

// ── Tests ────────────────────────────────────────────────────────────────────

describe('synthesize() — bounded-agentic engine', () => {
  it('returns a SynthesisResult with ≥1 citation when corpus is non-empty', async () => {
    mockRetrieveMemory.mockResolvedValue(null);
    mockRetrieveSources.mockResolvedValue([sourceChunk(1)]);

    const result = await synthesize(BASE_INPUT, {
      llmCall: async () => okLlmResponse(),
    });

    expect(result.citations.length).toBeGreaterThanOrEqual(1);
    expect(result.answer).toBeTruthy();
    expect(result.summary).toBeTruthy();
  });

  it('returns gapNote=null when hasGap=false', async () => {
    mockRetrieveMemory.mockResolvedValue(null);
    mockRetrieveSources.mockResolvedValue([sourceChunk(1)]);

    const result = await synthesize(BASE_INPUT, {
      llmCall: async () => okLlmResponse({ hasGap: false, gapNote: null }),
    });

    expect(result.gapNote).toBeNull();
  });

  it('fires gap requery when hasGap=true and passage count < 6', async () => {
    mockRetrieveMemory.mockResolvedValue(null);
    // First call: 2 chunks (< 6 total passages, below the threshold)
    mockRetrieveSources
      .mockResolvedValueOnce([sourceChunk(1), sourceChunk(2)])
      // Gap requery: return extra chunks
      .mockResolvedValueOnce([sourceChunk(3), sourceChunk(4)]);

    let callCount = 0;
    const result = await synthesize(BASE_INPUT, {
      llmCall: async () => {
        callCount++;
        if (callCount === 1) {
          // First call returns a gap response
          return JSON.stringify({
            summary: 'Partial answer.',
            answer: 'I found some info but not all. [0]',
            citations: [{ passageIndex: 0, label: 'Acme Contract', kind: 'source', sourceId: 'src-uuid-1', excerpt: 'Net-30 terms.' }],
            hasGap: true,
            gapNote: 'Missing information about late payment penalties.',
          });
        }
        // Second call (gap requery) returns a complete answer
        return okLlmResponse();
      },
    });

    expect(callCount).toBe(2);
    expect(mockRetrieveSources).toHaveBeenCalledTimes(2);
    expect(result.answer).toBeTruthy();
  });

  it('does NOT fire more than one gap requery (bounded-ness)', async () => {
    mockRetrieveMemory.mockResolvedValue(null);
    mockRetrieveSources
      .mockResolvedValueOnce([sourceChunk(1)])
      .mockResolvedValueOnce([sourceChunk(2)]);

    let callCount = 0;
    // Both LLM responses return hasGap=true — the engine must stop after one requery
    await synthesize(BASE_INPUT, {
      llmCall: async () => {
        callCount++;
        return JSON.stringify({
          summary: 'Partial.',
          answer: 'Still partial. [0]',
          citations: [{ passageIndex: 0, label: 'Acme', kind: 'source', sourceId: 'src-uuid-1', excerpt: 'text' }],
          hasGap: true,
          gapNote: 'Still missing info.',
        });
      },
    });

    // Should be at most 2 LLM calls total (compose + 1 gap requery)
    expect(callCount).toBeLessThanOrEqual(2);
    // And at most 2 source chunk fetches (initial + 1 requery)
    expect(mockRetrieveSources.mock.calls.length).toBeLessThanOrEqual(2);
  });

  it('gracefully degrades when LLM returns null (best-effort, never throws)', async () => {
    mockRetrieveMemory.mockResolvedValue(null);
    mockRetrieveSources.mockResolvedValue([sourceChunk(1)]);

    // llmCall returns null — engine should return EMPTY_RESULT without throwing
    const result = await synthesize(BASE_INPUT, {
      llmCall: async () => null,
    });

    expect(result).toBeDefined();
    expect(result.citations).toEqual([]);
    expect(result.answer).toBe('');
    expect(result.summary).toBe('');
  });

  it('gracefully degrades when retrieveMemoryBlock throws', async () => {
    mockRetrieveMemory.mockRejectedValue(new Error('memory db down'));
    mockRetrieveSources.mockResolvedValue([sourceChunk(1)]);

    // Should not throw; should still answer from sources
    const result = await synthesize(BASE_INPUT, {
      llmCall: async () => okLlmResponse(),
    });

    expect(result).toBeDefined();
    // answer may come from sources alone
    expect(result.answer).toBeTruthy();
  });

  it('gracefully degrades when retrieveSourceChunks throws', async () => {
    mockRetrieveMemory.mockResolvedValue(null);
    mockRetrieveSources.mockRejectedValue(new Error('source db down'));

    const result = await synthesize(BASE_INPUT, {
      llmCall: async () => okLlmResponse(),
    });

    expect(result).toBeDefined();
    // With no corpus, answer is empty or from LLM on empty passages
    // The engine must not throw
  });

  it('resolves within 12s — hard timeout test (mock a slow LLM)', async () => {
    mockRetrieveMemory.mockResolvedValue(null);
    mockRetrieveSources.mockResolvedValue([sourceChunk(1)]);

    const slowLlm = () => new Promise<string | null>(() => {
      // Never resolves — simulates a hung LLM call
      // The 12s hard timeout should fire and return EMPTY_RESULT
    });

    // We need to test that the engine doesn't hang forever.
    // Use a very fast timeout by checking that it resolves at all (within test timeout).
    // The engine has a 12s hard cap; we can't wait 12s in CI, so we just verify
    // the function returns without hanging by using a race with a shorter external timeout.
    const raceResult = await Promise.race([
      synthesize(BASE_INPUT, { llmCall: slowLlm }),
      // 13s safety net — if engine's own 12s cap doesn't fire, this test will timeout
      // via vitest's own test timeout. We just verify it resolves eventually.
      new Promise<'timeout'>((resolve) => setTimeout(() => resolve('timeout'), 13_000)),
    ]);

    // The engine's own 12s cap should have fired and returned EMPTY_RESULT
    // (not the 'timeout' sentinel from our outer race)
    if (raceResult === 'timeout') {
      throw new Error('Engine did not resolve within 13s — hard timeout did not fire');
    }
    expect(raceResult).toBeDefined();
    expect((raceResult as { answer: string }).answer).toBe('');
  }, 15_000);

  it('records two recordModelCall entries when gap requery fires', async () => {
    mockRetrieveMemory.mockResolvedValue(null);
    mockRetrieveSources
      .mockResolvedValueOnce([sourceChunk(1), sourceChunk(2)])
      .mockResolvedValueOnce([sourceChunk(3)]);

    let callCount = 0;
    await synthesize(BASE_INPUT, {
      llmCall: async () => {
        callCount++;
        if (callCount === 1) {
          return JSON.stringify({
            summary: 'Partial.',
            answer: 'Partial answer. [0]',
            citations: [{ passageIndex: 0, label: 'Acme', kind: 'source', sourceId: 'src-uuid-1', excerpt: 'text' }],
            hasGap: true,
            gapNote: 'Missing penalty clauses.',
          });
        }
        return okLlmResponse();
      },
    });

    expect(mockRecordModelCall).toHaveBeenCalledTimes(2);
  });

  it('records one recordModelCall entry on a normal compose (no gap)', async () => {
    mockRetrieveMemory.mockResolvedValue(null);
    mockRetrieveSources.mockResolvedValue([sourceChunk(1)]);

    await synthesize(BASE_INPUT, {
      llmCall: async () => okLlmResponse({ hasGap: false }),
    });

    expect(mockRecordModelCall).toHaveBeenCalledTimes(1);
  });

  it('returns corpusCounts.memory = number of memory rows retrieved', async () => {
    // Memory block with 2 non-empty lines → 2 memory passages
    const memoryBlock = 'What you\'ve learned about this account (use as context; treat "inferred" items as tentative):\n- (confirmed) Net-30 payment policy\n- (inferred) Prefers invoicing on Fridays';
    mockRetrieveMemory.mockResolvedValue(memoryBlock);
    mockRetrieveSources.mockResolvedValue([]);

    const result = await synthesize(BASE_INPUT, {
      llmCall: async () => JSON.stringify({
        summary: 'Memory-based answer.',
        answer: 'Based on memory, net-30 and Friday invoicing. [0]',
        citations: [{ passageIndex: 0, label: 'confirmed', kind: 'memory', sourceId: undefined, excerpt: 'Net-30 payment policy' }],
        hasGap: false,
        gapNote: null,
      }),
    });

    expect(result.corpusCounts.memory).toBe(2);
  });

  it('returns corpusCounts.sources = number of source chunk rows retrieved', async () => {
    mockRetrieveMemory.mockResolvedValue(null);
    mockRetrieveSources.mockResolvedValue([sourceChunk(1), sourceChunk(2), sourceChunk(3)]);

    const result = await synthesize(BASE_INPUT, {
      llmCall: async () => okLlmResponse(),
    });

    expect(result.corpusCounts.sources).toBe(3);
  });

  it('VOYAGE_API_KEY absent — embedQuery returns null — engine still returns an answer (FTS path)', async () => {
    // embedQuery already returns null by default (mocked in beforeEach)
    mockRetrieveMemory.mockResolvedValue(null);
    mockRetrieveSources.mockResolvedValue([sourceChunk(1)]);

    const result = await synthesize(BASE_INPUT, {
      llmCall: async () => okLlmResponse(),
    });

    // Should still work — retrieveSourceChunks uses FTS when embedding is null
    expect(result.answer).toBeTruthy();
    expect(result.citations.length).toBeGreaterThanOrEqual(1);
    // Verify embedQuery was called (or not — retrieve-sources uses it internally,
    // but we've mocked retrieve-sources so this just checks engine doesn't break)
    expect(result.gapNote).toBeNull();
  });
});
