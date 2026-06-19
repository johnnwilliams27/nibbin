/**
 * Config-pinned per-MTok rates for COGS accounting (§6.10 admin view, M6.5
 * pricing measurement). Verified against the official pricing page
 * 2026-06-12; re-verify whenever a model id changes (model changes already
 * gate on the eval suite, so the pin and the price move together).
 *
 * Costs are computed in micro-USD (1e-6 USD) so integer math stays exact at
 * fractions of a cent — model_calls.cost_microusd stores the result.
 */

export interface ModelRates {
  /** USD per million input tokens. */
  inputPerMTok: number;
  /** USD per million output tokens. */
  outputPerMTok: number;
  /** 5-minute ephemeral cache write premium: 1.25× input. */
  cacheWritePerMTok: number;
  /** Cache read: 10% of input. */
  cacheReadPerMTok: number;
}

function rates(input: number, output: number): ModelRates {
  return {
    inputPerMTok: input,
    outputPerMTok: output,
    cacheWritePerMTok: input * 1.25,
    cacheReadPerMTok: input * 0.1,
  };
}

/**
 * Longest-prefix match so dated snapshots resolve to their family.
 *
 * NOTE on `claude-fable-5`: no public per-token rate is pinned here yet, so it
 * is DELIBERATELY absent. The eval harness evaluates Fable as a quality/peer
 * challenger; its cost-delta line renders "N/A" (see `costMicroUsdOrNull`) and
 * its quality clearance is still valid. We do NOT invent a price — add a row
 * here only when an authoritative Fable rate exists (and that change re-kinds
 * any Fable pair where it proves cheaper than the incumbent).
 */
const MODEL_RATES: ReadonlyArray<[prefix: string, rates: ModelRates]> = [
  ['claude-haiku-4-5', rates(1, 5)],
  ['claude-sonnet-4-6', rates(3, 15)],
  ['claude-opus-4-8', rates(5, 25)],
];

export interface TokenUsage {
  inputTokens: number;
  cacheWriteTokens: number;
  cacheReadTokens: number;
  outputTokens: number;
}

/**
 * The rates for a model, or `null` when no pricing is pinned. Non-throwing —
 * for callers (the eval harness) that must tolerate an unpriced model (Fable)
 * gracefully rather than crash.
 */
export function ratesForModelOrNull(model: string): ModelRates | null {
  for (const [prefix, r] of MODEL_RATES) {
    if (model.startsWith(prefix)) return r;
  }
  return null;
}

export function ratesForModel(model: string): ModelRates {
  const r = ratesForModelOrNull(model);
  if (r) return r;
  // Fail loud: in the COGS ledger an unknown model id means the pin changed
  // without a pricing row — silently costing it at zero would corrupt the
  // margin measurement. (The eval harness uses costMicroUsdOrNull instead.)
  throw new Error(`no pricing pinned for model ${model} — add it to MODEL_RATES with the change that repins the model`);
}

function computeMicroUsd(r: ModelRates, usage: TokenUsage): number {
  const usd =
    (usage.inputTokens * r.inputPerMTok +
      usage.cacheWriteTokens * r.cacheWritePerMTok +
      usage.cacheReadTokens * r.cacheReadPerMTok +
      usage.outputTokens * r.outputPerMTok) /
    1_000_000;
  return Math.round(usd * 1_000_000);
}

/** Exact integer micro-USD for one call. Fails loud on an unpinned model. */
export function costMicroUsd(model: string, usage: TokenUsage): number {
  return computeMicroUsd(ratesForModel(model), usage);
}

/**
 * Exact integer micro-USD for one call, or `null` when the model has no pinned
 * price (graceful degradation for the eval harness — an unknown model like
 * `claude-fable-5` yields a cost-delta of "N/A", never a crash). Quality
 * clearance does not depend on cost, so a null here is purely informational.
 */
export function costMicroUsdOrNull(model: string, usage: TokenUsage): number | null {
  const r = ratesForModelOrNull(model);
  return r ? computeMicroUsd(r, usage) : null;
}
