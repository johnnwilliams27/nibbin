/**
 * Unit tests for the style extraction helpers (SPEC §4A Slice 1):
 *   • parseStyleResult: tolerates bad / partial JSON → null, validates schema;
 *   • derived-not-raw guard: battery + NER re-check on string fields;
 *   • extractStyleFromEdit: fail-safe (never throws), never returns raw text,
 *     returns null when draft unchanged or model unavailable.
 *
 * The model is mocked at the top level so tests run without an API key.
 */
import { describe, it, expect, vi } from 'vitest';
import { applyBattery } from '@nibbin/redaction';
import { parseStyleResult } from './extract';

// ---------------------------------------------------------------------------
// Mocks — hoisted before module resolution
// ---------------------------------------------------------------------------

const mockLlm = vi.fn();
const mockRecordModelCall = vi.fn().mockResolvedValue(undefined);
const mockRoute = vi.fn().mockResolvedValue({
  model: 'claude-haiku-test',
  tier: 't0' as const,
  degraded: false,
  requestedTier: 't0' as const,
  notice: null,
});

vi.mock('../llm/client', () => ({
  anthropicGenerate: () => mockLlm,
  recordModelCall: (...args: unknown[]) => mockRecordModelCall(...args),
}));

vi.mock('../grove/router', () => ({
  groveRouter: {
    route: (...args: unknown[]) => mockRoute(...args),
  },
}));

import { extractStyleFromEdit } from './extract';

// ---------------------------------------------------------------------------
// parseStyleResult
// ---------------------------------------------------------------------------

describe('parseStyleResult', () => {
  it('returns null on empty / non-JSON', () => {
    expect(parseStyleResult('')).toBeNull();
    expect(parseStyleResult('not json')).toBeNull();
    expect(parseStyleResult('[1,2,3]')).toBeNull(); // array, not object
  });

  it('returns null on malformed JSON', () => {
    expect(parseStyleResult('{bad json,,}')).toBeNull();
  });

  it('parses an empty object as a valid (all-null) result', () => {
    const result = parseStyleResult('{}');
    expect(result).toEqual({
      formality: null,
      sentiment: null,
      pace: null,
      signature_sign_offs: [],
      removals: [],
    });
  });

  it('clamps formality/sentiment/pace to their valid ranges', () => {
    const result = parseStyleResult(
      JSON.stringify({ formality: 2.5, sentiment: -5, pace: -0.1 }),
    );
    expect(result?.formality).toBe(1);
    expect(result?.sentiment).toBe(-1);
    expect(result?.pace).toBe(0);
  });

  it('trims and caps sign_offs and removals at their limits', () => {
    const lots = Array.from({ length: 10 }, (_, i) => `item${i}`);
    const result = parseStyleResult(
      JSON.stringify({ signature_sign_offs: lots, removals: lots }),
    );
    expect(result?.signature_sign_offs).toHaveLength(5);
    expect(result?.removals).toHaveLength(10);
  });

  it('drops non-string entries from string arrays', () => {
    const result = parseStyleResult(
      JSON.stringify({ signature_sign_offs: [42, null, 'Thanks,', ''], removals: [true] }),
    );
    expect(result?.signature_sign_offs).toEqual(['Thanks,']);
    expect(result?.removals).toEqual([]);
  });

  it('extracts from text containing surrounding prose (JSON embedded in prose)', () => {
    const result = parseStyleResult(
      'Here is what I found: {"formality": 0.3, "pace": 0.7} — that is it.',
    );
    expect(result?.formality).toBeCloseTo(0.3);
    expect(result?.pace).toBeCloseTo(0.7);
  });

  it('an email in sign_offs would be flagged by applyBattery (redaction guard sanity)', () => {
    const tainted = 'contact jane@example.com';
    expect(applyBattery(tainted).rulesHit.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// extractStyleFromEdit fail-safe
// ---------------------------------------------------------------------------

describe('extractStyleFromEdit fail-safe', () => {
  it('returns null when original equals edited', async () => {
    const result = await extractStyleFromEdit({
      accountId: 'acc-1',
      userId: 'user-1',
      runId: 'run-1',
      originalDraft: 'Hello world',
      editedDraft: 'Hello world', // unchanged
    });
    expect(result).toBeNull();
  });

  it('returns null when original is empty', async () => {
    const result = await extractStyleFromEdit({
      accountId: 'acc-1',
      userId: 'user-1',
      runId: 'run-1',
      originalDraft: '',
      editedDraft: 'Some edit',
    });
    expect(result).toBeNull();
  });

  it('returns null (not throws) when the model function returns an error', async () => {
    mockLlm.mockRejectedValueOnce(new Error('network error'));
    await expect(
      extractStyleFromEdit({
        accountId: 'acc-1',
        userId: 'user-1',
        runId: 'run-1',
        originalDraft: 'Original text',
        editedDraft: 'Edited text with changes',
      }),
    ).resolves.toBeNull();
  });

  it('discards result when string fields contain PII (redaction hit)', async () => {
    // Model returns a result with an email in sign_offs — the guard discards it.
    mockLlm.mockResolvedValueOnce({
      text: JSON.stringify({ signature_sign_offs: ['jane.doe@example.com'] }),
      model: 'claude-haiku-test',
      usage: { inputTokens: 10, cacheWriteTokens: 0, cacheReadTokens: 0, outputTokens: 10 },
    });
    const result = await extractStyleFromEdit({
      accountId: 'acc-1',
      userId: 'user-1',
      runId: 'run-1',
      originalDraft: 'Original text here',
      editedDraft: 'Edited text here with changes',
    });
    expect(result).toBeNull();
  });

  it('returns a valid ToneProfile when the model returns clean attributes', async () => {
    const mockAttrs = {
      formality: 0.3,
      sentiment: 0.5,
      pace: 0.4,
      signature_sign_offs: ['Thanks,'],
      removals: ['passive voice'],
    };
    mockLlm.mockResolvedValueOnce({
      text: JSON.stringify(mockAttrs),
      model: 'claude-haiku-test',
      usage: { inputTokens: 10, cacheWriteTokens: 0, cacheReadTokens: 0, outputTokens: 10 },
    });
    const result = await extractStyleFromEdit({
      accountId: 'acc-1',
      userId: 'user-1',
      runId: 'run-1',
      originalDraft: 'Original draft text here',
      editedDraft: 'Edited draft text here with changes',
    });
    expect(result).not.toBeNull();
    expect(result?.formality).toBeCloseTo(0.3);
    expect(result?.signature_sign_offs).toEqual(['Thanks,']);
    expect(result?.removals).toEqual(['passive voice']);
  });

  it('returns null when model returns unparseable JSON', async () => {
    mockLlm.mockResolvedValueOnce({
      text: 'I cannot extract anything',
      model: 'claude-haiku-test',
      usage: { inputTokens: 5, cacheWriteTokens: 0, cacheReadTokens: 0, outputTokens: 5 },
    });
    const result = await extractStyleFromEdit({
      accountId: 'acc-1',
      userId: 'user-1',
      runId: 'run-1',
      originalDraft: 'Original text here',
      editedDraft: 'Edited version here',
    });
    expect(result).toBeNull();
  });
});
