import 'server-only';

/**
 * The specialist drafting voice (M6.5) — the runner's ModelDrafter.
 *
 * DRAFTING_SYSTEM_PROMPT is the STABLE cacheable block (identical bytes for
 * every account and run; editing it is a prompt change and gates on the
 * eval suite). The per-call turn carries only the pattern intent + the
 * small sanitized context — paid tokens stay tiny.
 *
 * Injection posture: the drafter consumes metadata that already passed the
 * connector sanitizers, and its OUTPUT goes back through quarantine before
 * a program touches it. The prompt still instructs data-not-instructions —
 * defense in depth, not the load-bearing wall (that's the runtime gate).
 */
import { groveRouter } from '../grove/router';
import { anthropicGenerate, recordModelCall } from './client';
import { DRAFTING_SYSTEM_PROMPT } from './prompts';
import type { ModelDrafter } from '@nibbin/runtime';

/**
 * Build the runner's model seam for one account. Drafting is T1 work routed
 * as 'specialist_draft' / pipeline; the router never consults the frontier
 * budget for it, and the COGS row lands on the account + run.
 */
export function modelDrafterFor(accountId: string): ModelDrafter | undefined {
  const llm = anthropicGenerate();
  if (!llm) return undefined; // honest no-model path: deterministic templates

  return {
    async draft({ runId, intent, context, maxTokens }) {
      try {
        const decision = await groveRouter.route({
          userId: `account:${accountId}`,
          task: 'specialist_draft',
          origin: 'pipeline',
        });
        const result = await llm({
          model: decision.model,
          system: [{ text: DRAFTING_SYSTEM_PROMPT, cache: true }],
          messages: [{ role: 'user', content: `${intent}\n\nContext:\n${context}` }],
          maxTokens,
          temperature: 0.6,
        });
        await recordModelCall({
          accountId,
          userId: null,
          runId,
          tier: decision.tier,
          task: 'specialist_draft',
          model: result.model,
          usage: result.usage,
        });
        const text = result.text.trim();
        if (text === '') return null;
        // ceiling math counts what the run consumed: prompt + completion
        return { text, tokens: result.usage.inputTokens + result.usage.outputTokens };
      } catch (err) {
        console.error('[drafting] model call failed — deterministic fallback', err instanceof Error ? err.message : err);
        return null;
      }
    },
  };
}
