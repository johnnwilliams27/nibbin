import 'server-only';

/**
 * The web app's model client + COGS recorder (M6.5).
 *
 * - One fetch-based Anthropic client per process, keyed from
 *   ANTHROPIC_API_KEY. When the key is absent (e.g. a fresh dev checkout),
 *   anthropicGenerate() returns null and every caller falls back to its
 *   honest no-model path (scripted keeper floor, deterministic drafts) —
 *   nothing routes, nothing debits (#25).
 * - recordModelCall writes one model_calls row per real call: the full
 *   token/cache split plus exact micro-USD cost. This ledger IS the M6.5
 *   pricing measurement and the §6.10 admin COGS view; failures to record
 *   are logged loudly but never fail the user's request.
 */
import { costMicroUsd, createAnthropicClient, type Generate, type TokenUsage, type Tier } from '@nibbin/router';
import { serviceClient } from '../supabase/service';

const forGlobal = globalThis as typeof globalThis & { __nibbinGenerate?: Generate | null };

export function anthropicGenerate(): Generate | null {
  if (forGlobal.__nibbinGenerate !== undefined) return forGlobal.__nibbinGenerate;
  const apiKey = process.env.ANTHROPIC_API_KEY;
  forGlobal.__nibbinGenerate = apiKey && apiKey.trim() !== '' ? createAnthropicClient({ apiKey }) : null;
  return forGlobal.__nibbinGenerate;
}

export interface ModelCallRecord {
  accountId: string | null;
  userId: string | null;
  runId?: string | null;
  tier: Tier;
  task: string;
  model: string;
  usage: TokenUsage;
  origin?: 'chat' | 'pipeline';
  channel?: string;
  /**
   * Routing-reinforcement Slice A signals (pure observability — they change
   * nothing about which model route() picked). All optional + back-compat:
   *  - outcome: 'ok' (default) for a real completion; 'error' / 'refusal' on a
   *    graceful failure (provider error / rate-limit, or a model decline). An
   *    error/refusal row is the previously-invisible failure being ledgered —
   *    it carries ZERO tokens and NEVER any prompt/response content.
   *  - degraded: route()'s decision.degraded (budget forced T2→T1). Default false.
   *  - latencyMs: model-call wall time; null (default) when not measured.
   */
  outcome?: 'ok' | 'refusal' | 'error';
  degraded?: boolean;
  latencyMs?: number | null;
}

export async function recordModelCall(rec: ModelCallRecord): Promise<void> {
  try {
    const svc = serviceClient();
    const { error } = await svc.from('model_calls').insert({
      account_id: rec.accountId,
      user_id: rec.userId,
      run_id: rec.runId ?? null,
      tier: rec.tier,
      task: rec.task,
      model: rec.model,
      input_tokens: rec.usage.inputTokens,
      cache_write_tokens: rec.usage.cacheWriteTokens,
      cache_read_tokens: rec.usage.cacheReadTokens,
      output_tokens: rec.usage.outputTokens,
      cost_microusd: costMicroUsd(rec.model, rec.usage),
      origin: rec.origin ?? null,
      channel: rec.channel ?? null,
      outcome: rec.outcome ?? 'ok',
      degraded: rec.degraded ?? false,
      latency_ms: rec.latencyMs ?? null,
    });
    if (error) console.error('[cogs] model_calls insert failed', error.message);
  } catch (err) {
    console.error('[cogs] model_calls insert crashed', err instanceof Error ? err.message : err);
  }
}
