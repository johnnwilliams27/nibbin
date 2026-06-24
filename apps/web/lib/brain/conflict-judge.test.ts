/**
 * Unit tests for conflict-judge.ts — LLM-judged semantic contradiction.
 *
 * The model client is injected (no real API). Tests assert the layering +
 * fail-open contract.
 *
 * Run: npx vitest run apps/web/lib/brain/conflict-judge.test.ts
 */
import { describe, it, expect, vi } from 'vitest';
import { judgeContradiction, shouldSuppress, type JudgeDeps, type JudgeOutcome } from './conflict-judge';
import type { GenerateResult } from '@nibbin/router';

function fakeResult(text: string): GenerateResult {
  return {
    text,
    usage: { inputTokens: 10, cacheWriteTokens: 0, cacheReadTokens: 0, outputTokens: 5 },
    stopReason: 'end_turn',
    model: 'claude-haiku-4-5-20251001',
  };
}

function deps(overrides: Partial<JudgeDeps> = {}): JudgeDeps {
  return {
    generate: vi.fn(async () => fakeResult('{"verdict":"contradiction","reason":"x"}')),
    model: 'claude-haiku-4-5-20251001',
    tier: 't1',
    recordCall: vi.fn(async () => {}),
    ...overrides,
  };
}

const CANDIDATE = {
  fieldKey: 'pricing',
  values: ['50% deposit', '30% deposit'],
};

describe('judgeContradiction — verdicts', () => {
  it('parses a contradiction verdict', async () => {
    const d = deps({ generate: vi.fn(async () => fakeResult('{"verdict":"contradiction","reason":"different deposit %"}')) });
    const out = await judgeContradiction(CANDIDATE, 'acct-1', d);
    expect(out.verdict).toBe('contradiction');
    expect(out.shouldFlag).toBe(true);
  });

  it('parses a compatible verdict → suppress (do not flag)', async () => {
    const d = deps({ generate: vi.fn(async () => fakeResult('{"verdict":"compatible","reason":"same thing phrased differently"}')) });
    const out = await judgeContradiction({ fieldKey: 'policies', values: ['Net 30', 'net-30 days'] }, 'acct-1', d);
    expect(out.verdict).toBe('compatible');
    expect(out.shouldFlag).toBe(false);
  });

  it('records the model call', async () => {
    const recordCall = vi.fn(async () => {});
    const d = deps({ recordCall });
    await judgeContradiction(CANDIDATE, 'acct-1', d);
    expect(recordCall).toHaveBeenCalledTimes(1);
  });
});

describe('judgeContradiction — fail-open contract', () => {
  it('an unparseable model reply falls back to flagging (uncertain)', async () => {
    const d = deps({ generate: vi.fn(async () => fakeResult('I am not sure, it depends')) });
    const out = await judgeContradiction(CANDIDATE, 'acct-1', d);
    expect(out.verdict).toBe('uncertain');
    expect(out.shouldFlag).toBe(true);
  });

  it('an explicit uncertain verdict falls back to flagging', async () => {
    const d = deps({ generate: vi.fn(async () => fakeResult('{"verdict":"uncertain","reason":"ambiguous"}')) });
    const out = await judgeContradiction(CANDIDATE, 'acct-1', d);
    expect(out.verdict).toBe('uncertain');
    expect(out.shouldFlag).toBe(true);
  });

  it('a model error falls back to flagging and still records an error call', async () => {
    const recordCall: JudgeDeps['recordCall'] = vi.fn(async () => {});
    const d = deps({
      generate: vi.fn(async () => {
        throw new Error('429 rate limited');
      }),
      recordCall,
    });
    const out = await judgeContradiction(CANDIDATE, 'acct-1', d);
    expect(out.verdict).toBe('uncertain');
    expect(out.shouldFlag).toBe(true);
    expect(recordCall).toHaveBeenCalledTimes(1);
    expect(vi.mocked(recordCall).mock.calls[0]?.[0].outcome).toBe('error');
  });
});

describe('judgeContradiction — fewer than 2 values', () => {
  it('never calls the model when there is nothing to compare and flags by default', async () => {
    const generate: JudgeDeps['generate'] = vi.fn(async () => fakeResult('{"verdict":"compatible","reason":"x"}'));
    const d = deps({ generate });
    const out = await judgeContradiction({ fieldKey: 'pricing', values: ['only one'] }, 'acct-1', d);
    expect(generate).not.toHaveBeenCalled();
    expect(out.shouldFlag).toBe(true);
    expect(out.verdict).toBe('uncertain');
  });
});

describe('judgeContradiction — prompt safety', () => {
  it('sends the field values as data, not as a system role', async () => {
    const generate: JudgeDeps['generate'] = vi.fn(async () => fakeResult('{"verdict":"contradiction","reason":"x"}'));
    const d = deps({ generate });
    await judgeContradiction(CANDIDATE, 'acct-1', d);
    const req = vi.mocked(generate).mock.calls[0]?.[0];
    // system prompt is the instruction; values arrive in the user message
    expect(req?.system.some((b) => /contradict/i.test(b.text))).toBe(true);
    expect(req?.maxTokens).toBeLessThanOrEqual(300);
  });

  it('caps the number of values sent to the model', async () => {
    const generate: JudgeDeps['generate'] = vi.fn(async () => fakeResult('{"verdict":"contradiction","reason":"x"}'));
    const d = deps({ generate });
    const manyValues = Array.from({ length: 20 }, (_, i) => `value-${i}`);
    await judgeContradiction({ fieldKey: 'faq', values: manyValues }, 'acct-1', d);
    const req = vi.mocked(generate).mock.calls[0]?.[0];
    const userText = typeof req?.messages[0]?.content === 'string' ? req.messages[0].content : '';
    // MAX_VALUES = 8 → "value-8" (the 9th) must NOT appear.
    expect(userText).toContain('value-7');
    expect(userText).not.toContain('value-8');
  });
});

describe('shouldSuppress — high-stakes is never suppressed', () => {
  const compatible: JudgeOutcome = { verdict: 'compatible', reason: 'same thing', shouldFlag: false };
  const contradiction: JudgeOutcome = { verdict: 'contradiction', reason: 'x', shouldFlag: true };

  it('suppresses a confident-compatible NORMAL-stakes candidate', () => {
    expect(shouldSuppress(compatible, 'normal')).toBe(true);
  });

  it('NEVER suppresses a HIGH-stakes candidate, even when judged compatible', () => {
    // The crux fix: a single T1 "compatible" verdict must not delete a
    // pricing/policy/hard-rule conflict from the owner's review.
    expect(shouldSuppress(compatible, 'high')).toBe(false);
  });

  it('never suppresses a contradiction verdict at either stakes', () => {
    expect(shouldSuppress(contradiction, 'normal')).toBe(false);
    expect(shouldSuppress(contradiction, 'high')).toBe(false);
  });
});
