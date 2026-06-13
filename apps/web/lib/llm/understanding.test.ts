import { describe, expect, it } from 'vitest';
import { understandingModelTurn } from './understanding';
import type { Generate } from '@nibbin/router';

const fakeRoute = { route: async () => ({ model: 'claude-haiku-4-5-20251001', tier: 't1', degraded: false }) };

function generateReturning(text: string): Generate {
  return (async () => ({ model: 'claude-haiku-4-5-20251001', text, usage: { inputTokens: 10, cacheWriteTokens: 0, cacheReadTokens: 0, outputTokens: 20 } })) as unknown as Generate;
}

describe('understandingModelTurn', () => {
  it('parses a well-formed model JSON into an UnderstandingModelTurn', async () => {
    const json = JSON.stringify({
      extraction: { jobTitle: 'florist', businessModel: 'bookings' },
      nextQuestion: { prompt: 'Where do orders come in?', placeholder: 'Phone, email…' },
      confidence: 0.5,
    });
    const result = await understandingModelTurn('acc', 'user', [{ q: 'what do you do?', a: 'flowers' }], {
      generate: generateReturning(json),
      router: fakeRoute as never,
    });
    expect(result?.extraction.jobTitle).toBe('florist');
    expect(result?.nextQuestion?.prompt).toBe('Where do orders come in?');
  });

  it('returns null on malformed JSON (caller falls back to static questions)', async () => {
    const result = await understandingModelTurn('acc', 'user', [], {
      generate: generateReturning('not json at all'),
      router: fakeRoute as never,
    });
    expect(result).toBeNull();
  });

  it('returns null when no model is wired', async () => {
    const result = await understandingModelTurn('acc', 'user', [], { generate: null, router: fakeRoute as never });
    expect(result).toBeNull();
  });

  it('returns a result with confidence=0 when top-level confidence is missing but otherwise valid', async () => {
    const json = JSON.stringify({
      extraction: { jobTitle: 'tailor' },
      nextQuestion: { prompt: 'How do clients find you?', placeholder: 'Word of mouth…' },
      // no confidence field
    });
    const result = await understandingModelTurn('acc', 'user', [], {
      generate: generateReturning(json),
      router: fakeRoute as never,
    });
    expect(result).not.toBeNull();
    expect(result?.confidence).toBe(0);
    expect(result?.extraction.jobTitle).toBe('tailor');
  });
});
