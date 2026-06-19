import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { Generate } from '@nibbin/router';

// Capture recordModelCall payloads so the Slice-A signal threading is asserted
// (degraded/latency/outcome on success; an outcome='error' ledger row on a
// graceful model-call failure, carrying zero tokens + no content).
const recorded: Array<Record<string, unknown>> = [];
vi.mock('./client', () => ({
  anthropicGenerate: () => null,
  recordModelCall: vi.fn(async (rec: Record<string, unknown>) => {
    recorded.push(rec);
  }),
}));

import { understandingModelTurn } from './understanding';

const fakeRoute = { route: async () => ({ model: 'claude-haiku-4-5-20251001', tier: 't1', degraded: false }) };

function generateReturning(text: string): Generate {
  return (async () => ({ model: 'claude-haiku-4-5-20251001', text, usage: { inputTokens: 10, cacheWriteTokens: 0, cacheReadTokens: 0, outputTokens: 20 } })) as unknown as Generate;
}

function generateThrowing(): Generate {
  return (async () => {
    throw new Error('provider 529 overloaded');
  }) as unknown as Generate;
}

beforeEach(() => {
  recorded.length = 0;
});

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

  it('records the success call with Slice-A signals (degraded/latency/outcome=ok)', async () => {
    const json = JSON.stringify({ extraction: { jobTitle: 'florist' }, nextQuestion: null, confidence: 0.9 });
    await understandingModelTurn('acc', 'user', [{ q: 'q', a: 'a' }], {
      generate: generateReturning(json),
      router: fakeRoute as never,
    });
    expect(recorded).toHaveLength(1);
    const rec = recorded[0];
    expect(rec.outcome).toBe('ok');
    expect(rec.degraded).toBe(false);
    expect(typeof rec.latencyMs).toBe('number');
    expect(rec.task).toBe('onboarding_understanding');
  });

  it('ledgers a graceful model-call failure as outcome=error with zero tokens and no content', async () => {
    const result = await understandingModelTurn('acc', 'user', [{ q: 'q', a: 'a' }], {
      generate: generateThrowing(),
      router: fakeRoute as never,
    });
    expect(result).toBeNull(); // caller falls back to the static question
    expect(recorded).toHaveLength(1);
    const rec = recorded[0] as Record<string, unknown>;
    expect(rec.outcome).toBe('error');
    expect(rec.latencyMs).toBeNull();
    expect(rec.task).toBe('onboarding_understanding');
    const usage = rec.usage as Record<string, number>;
    expect(usage.inputTokens).toBe(0);
    expect(usage.outputTokens).toBe(0);
    // The ledger row carries NO prompt/response content (privacy).
    for (const forbidden of ['prompt', 'response', 'text', 'content', 'messages']) {
      expect(Object.keys(rec)).not.toContain(forbidden);
    }
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
