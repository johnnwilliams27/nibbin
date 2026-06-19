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
import { loadGroveMemoryBlock } from '../grove/memory';
import { memoryBlockFor } from '../memory/retrieve';
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

  // Grove Memory (§4.8) is loaded once per run and cached in this closure: a
  // second cacheable system block, after the stable drafting prompt, so the
  // model sees the business brain on every draft without re-reading the DB.
  let memoryBlock: string | null | undefined; // undefined = not yet loaded
  async function groveBlock(): Promise<string | null> {
    if (memoryBlock === undefined) memoryBlock = await loadGroveMemoryBlock(accountId);
    return memoryBlock;
  }

  return {
    async draft({ runId, intent, context, maxTokens }) {
      // Captured so the graceful-failure ledger row (catch) records the model/
      // tier route() actually resolved (Slice A) — not a placeholder.
      let resolvedModel = 'unknown';
      let resolvedTier: 't0' | 't1' | 't2' = 't1';
      let resolvedDegraded = false;
      try {
        const decision = await groveRouter.route({
          userId: `account:${accountId}`,
          task: 'specialist_draft',
          origin: 'pipeline',
        });
        resolvedModel = decision.model;
        resolvedTier = decision.tier;
        resolvedDegraded = decision.degraded;
        const memory = await groveBlock();
        // Agent/user memory (§12A): retrieved per draft (semantic + FTS +
        // recency), injected as a third system block after Grove Memory.
        // Best-effort — null on any failure, never blocks the draft. NOT cached:
        // it varies by intent, so it stays in the volatile (uncached) suffix.
        // INVARIANT: only the static pattern `intent` is embedded/sent to the
        // embedding subprocessor (Voyage); never `context` or connector content.
        // Future programs must keep `intent` free of interpolated evidence.
        const mem = await memoryBlockFor(runId, intent);
        const system = [
          { text: DRAFTING_SYSTEM_PROMPT, cache: true },
          ...(memory ? [{ text: memory, cache: true }] : []),
          ...(mem ? [{ text: mem, cache: false }] : []),
        ];
        const t0 = Date.now();
        const result = await llm({
          model: decision.model,
          system,
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
          degraded: decision.degraded,
          latencyMs: Date.now() - t0,
          outcome: 'ok',
        });
        const text = result.text.trim();
        if (text === '') return null;
        // ceiling math counts EVERY token the run consumed — cached prefix
        // tokens are real consumption (billed, just discounted), and omitting
        // them lets a run slip past its §6.2 token ceiling in real-token terms
        // (gate finding logic-skeptic P1).
        const u = result.usage;
        return { text, tokens: u.inputTokens + u.cacheWriteTokens + u.cacheReadTokens + u.outputTokens };
      } catch (err) {
        console.error('[drafting] model call failed — deterministic fallback', err instanceof Error ? err.message : err);
        // Ledger the previously-invisible graceful failure (Slice A): a row with
        // outcome='error', zero tokens, NO prompt/response content, on the model/
        // tier route() resolved (placeholder only if route() itself threw).
        await recordModelCall({
          accountId,
          userId: null,
          runId,
          tier: resolvedTier,
          task: 'specialist_draft',
          model: resolvedModel,
          usage: { inputTokens: 0, cacheWriteTokens: 0, cacheReadTokens: 0, outputTokens: 0 },
          outcome: 'error',
          degraded: resolvedDegraded,
          latencyMs: null,
        });
        return null;
      }
    },
  };
}
