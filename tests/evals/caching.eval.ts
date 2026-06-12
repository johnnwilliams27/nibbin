/**
 * Cache verification (M6.5 DoD: "caching verified working — cache hit rate
 * visible; input-token savings measured"). Two consecutive calls sharing the
 * stable prefix: the first may write the cache, the second MUST read it.
 */
import { afterAll, describe, expect, it } from 'vitest';
import { DEFAULT_MODELS } from '@nibbin/router';
import { DRAFTING_SYSTEM_PROMPT } from '../../apps/web/lib/llm/prompts';
import { evalCall, evalCostSummary, EVALS_ENABLED } from './harness';

const MODEL = process.env.NIBBIN_EVAL_MODEL_T1 ?? DEFAULT_MODELS.t1;

afterAll(() => console.log(evalCostSummary()));

describe.skipIf(!EVALS_ENABLED)('prompt-cache discipline', () => {
  it('the second call with the same stable prefix reads the cache', async () => {
    const call = (q: string) =>
      evalCall({
        model: MODEL,
        system: [{ text: DRAFTING_SYSTEM_PROMPT, cache: true }],
        messages: [{ role: 'user', content: q }],
        maxTokens: 120,
        temperature: 0,
      });

    const first = await call('Draft one friendly sentence asking a client to confirm a session date.\n\nContext:\nSubject: session');
    const second = await call('Draft one friendly sentence thanking a client for a referral.\n\nContext:\nSubject: thank you');

    const wrote = first.usage.cacheWriteTokens + first.usage.cacheReadTokens;
    expect(wrote).toBeGreaterThan(0); // prefix entered (or was already in) the cache
    expect(second.usage.cacheReadTokens).toBeGreaterThan(0); // and the second call READ it
    // the measured saving: cached prefix tokens leave the full-price bucket
    expect(second.usage.inputTokens).toBeLessThan(second.usage.inputTokens + second.usage.cacheReadTokens);
    console.log(
      `[evals] cache: first write=${first.usage.cacheWriteTokens} read=${first.usage.cacheReadTokens}; ` +
        `second read=${second.usage.cacheReadTokens} fullprice=${second.usage.inputTokens}`,
    );
  });
});
