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
import { creditsForCostMicroUsd } from '@nibbin/shared';
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
  /**
   * The account's model_contribution_enabled flag (accounts.model_contribution_enabled,
   * default true = opted IN). When explicitly false the call is NOT recorded into
   * model_calls — the account's data is excluded from the aggregate contribution
   * path entirely (R49 / D1-A). COGS callers that do not have the flag available
   * may omit this field (it defaults to true, preserving existing behaviour).
   */
  modelContributionEnabled?: boolean;
  /**
   * "This call's run already posted a FLAT credit charge, so do NOT usage-charge
   * it (avoids double-charging)." Set true by exactly the two surfaces that post a
   * flat per-run charge: the Nibbin-run drafting path (run_begin) and the diagnosis
   * path (chargeDiagnosis). Everything else — including the planner ReAct loop
   * (which posts NO ledger charge of its own) and all post-run derivations
   * (style/memory extraction) — leaves this falsy and is usage-charged.
   *
   * This REPLACES the old `runId`-presence heuristic, which silently zero-billed
   * every planner-loop model call (the most expensive frontier / computer_use
   * loop in the product) because they carry runId = plan_runs.id but pay no flat
   * charge. Usage is now charged iff NOT flatCharged ("charge on everything").
   */
  flatCharged?: boolean;
}

export async function recordModelCall(rec: ModelCallRecord): Promise<void> {
  // R49 / D1-A: an account that has opted out of the model-improvement
  // contribution (model_contribution_enabled = false) must not generate rows in
  // the model_calls table at all. The aggregate view (model_task_performance)
  // also filters on this flag, but gating here ensures opted-out data never
  // lands in the ledger in the first place.
  if (rec.modelContributionEnabled === false) return;
  try {
    const svc = serviceClient();
    const cost = costMicroUsd(rec.model, rec.usage);
    const { data, error } = await svc
      .from('model_calls')
      .insert({
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
        cost_microusd: cost,
        origin: rec.origin ?? null,
        channel: rec.channel ?? null,
        outcome: rec.outcome ?? 'ok',
        degraded: rec.degraded ?? false,
        latency_ms: rec.latencyMs ?? null,
      })
      .select('id')
      .single();
    if (error) {
      console.error('[cogs] model_calls insert failed', error.message);
      return;
    }
    await chargeUsage(svc, rec, cost, (data as { id: string } | null)?.id ?? null);
  } catch (err) {
    console.error('[cogs] model_calls insert crashed', err instanceof Error ? err.message : err);
  }
}

/**
 * Usage-based credit metering (feat/credit-metering-usage). After a model_calls
 * COGS row lands, decrement the account's credits by the call's cost.
 *
 * Reconciliation with the flat per-run charge (no double charge): the two
 * surfaces that post a flat per-run charge — the Nibbin-run drafting path
 * (run_begin) and diagnosis (chargeDiagnosis) — set `flatCharged: true`, so their
 * model calls are NOT usage-charged here (that single unit of work was already
 * paid for). EVERY other call usage-charges, including the planner ReAct loop
 * (which carries runId = plan_runs.id but posts no flat charge — the leak this
 * closes) and post-run derivations (chat, onboarding, plan synthesis, doc/vision
 * extraction, style/memory derivation). Charge usage iff NOT flatCharged — we no
 * longer key off run_id presence, which zero-billed the planner.
 *
 * SOFT-GATE: this charge is POST-HOC for a call that already completed, so it
 * ALWAYS lands and the result ALWAYS posts — even into a negative balance. The
 * DB 'usage' reason is exempt from the overdraw guard by design. Starting NEW
 * expensive work (a run / planner run) is gated up front elsewhere. A charge
 * failure is logged loudly but never fails the user's request (best-effort,
 * like the COGS write itself).
 */
async function chargeUsage(
  svc: ReturnType<typeof serviceClient>,
  rec: ModelCallRecord,
  costMicroUsd: number,
  callId: string | null,
): Promise<void> {
  // Calls whose run already posted a flat charge (Nibbin run_begin / diagnosis)
  // are covered — never usage-charge them. Do NOT key off runId: the planner loop
  // carries runId but pays no flat charge, so it must usage-charge.
  if (rec.flatCharged) return;
  if (!rec.accountId || !callId) return;
  const credits = creditsForCostMicroUsd(costMicroUsd);
  if (credits <= 0) return; // near-free call rounds to 0 — nothing to charge
  const { error } = await svc.rpc('charge_model_usage', {
    p_account: rec.accountId,
    p_call_id: callId,
    p_credits: credits,
  });
  if (error) console.error('[cogs] usage charge failed', error.message);
}
