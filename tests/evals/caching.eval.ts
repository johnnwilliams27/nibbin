/**
 * Cache verification (M6.5 DoD: "caching verified working — cache hit rate
 * visible; input-token savings measured").
 *
 * Live finding from the first verification run: the API silently ignores
 * cache_control on prompts BELOW the model's minimum cacheable length
 * (1024–2048 tokens depending on model class). Today's voice blocks are
 * ~200–450 tokens, so production calls don't cache yet — and don't need to
 * (the whole prefix costs ~$0.0002). The discipline pays off the moment
 * Grove Memory joins the stable prefix (SPEC §4.8); this eval proves the
 * MECHANISM end-to-end with a prefix above every model's minimum, so that
 * day already works.
 */
import { afterAll, describe, expect, it } from 'vitest';
import { DEFAULT_MODELS } from '@nibbin/router';
import { DRAFTING_SYSTEM_PROMPT } from '../../apps/web/lib/llm/prompts';
import { evalCall, evalCostSummary, EVALS_ENABLED } from './harness';

const MODEL = process.env.NIBBIN_EVAL_MODEL_T1 ?? DEFAULT_MODELS.t1;

// A deterministic stable block comfortably above the minimum cacheable
// length for every model class (~4500 tokens). Identical bytes every run —
// cache identity requires it (a rerun may even open with a cache READ).
const GROVE_MEMORY_STAND_IN =
  'Reference notes about this business, section ' +
  Array.from({ length: 300 }, (_, i) =>
    `${i}: The studio books weddings, portraits and mini sessions; galleries deliver within twenty-one days; ` +
    'retainers are non-refundable but transferable once; weekday morning slots carry a loyalty discount; ' +
    'inquiries are answered within one business day in a warm, plainspoken voice.',
  ).join('\nsection ');

afterAll(() => console.log(evalCostSummary()));

describe.skipIf(!EVALS_ENABLED)('prompt-cache discipline', () => {
  it('above the minimum cacheable length, the second call reads the cache', async () => {
    const call = (q: string) =>
      evalCall({
        model: MODEL,
        system: [
          { text: DRAFTING_SYSTEM_PROMPT, cache: false },
          { text: GROVE_MEMORY_STAND_IN, cache: true },
        ],
        messages: [{ role: 'user', content: q }],
        maxTokens: 120,
        temperature: 0,
      });

    const first = await call('Draft one friendly sentence asking a client to confirm a session date.\n\nContext:\nSubject: session');
    const second = await call('Draft one friendly sentence thanking a client for a referral.\n\nContext:\nSubject: thank you');

    const wrote = first.usage.cacheWriteTokens + first.usage.cacheReadTokens;
    expect(wrote).toBeGreaterThan(1000); // the big prefix entered (or already sat in) the cache
    expect(second.usage.cacheReadTokens).toBeGreaterThan(1000); // and the second call READ it
    // the measured saving: cached tokens bill at 10% of input rate
    const savedTokens = second.usage.cacheReadTokens;
    console.log(
      `[evals] cache: first write=${first.usage.cacheWriteTokens} read=${first.usage.cacheReadTokens}; ` +
        `second read=${second.usage.cacheReadTokens} fullprice=${second.usage.inputTokens} ` +
        `(~${Math.round((savedTokens * 0.9 * 100) / (savedTokens + second.usage.inputTokens))}% input-cost saving)`,
    );
  });

  it('documents the production reality: sub-minimum prompts do not cache (and cost ~nothing)', async () => {
    const result = await evalCall({
      model: MODEL,
      system: [{ text: DRAFTING_SYSTEM_PROMPT, cache: true }], // ~210 tokens — below every minimum
      messages: [{ role: 'user', content: 'Draft one friendly sentence confirming receipt.\n\nContext:\nSubject: hello' }],
      maxTokens: 80,
      temperature: 0,
    });
    // If this ever starts caching (API change or a grown prompt), the eval
    // flags it so the cost model gets re-measured.
    expect(result.usage.cacheWriteTokens + result.usage.cacheReadTokens).toBe(0);
    expect(result.usage.inputTokens).toBeLessThan(400);
  });
});
