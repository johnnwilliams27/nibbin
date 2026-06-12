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

/** Longest-prefix match so dated snapshots resolve to their family. */
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

export function ratesForModel(model: string): ModelRates {
  for (const [prefix, r] of MODEL_RATES) {
    if (model.startsWith(prefix)) return r;
  }
  // Fail loud: an unknown model id means the pin changed without a pricing
  // row — silently costing it at zero would corrupt the margin measurement.
  throw new Error(`no pricing pinned for model ${model} — add it to MODEL_RATES with the change that repins the model`);
}

/** Exact integer micro-USD for one call. */
export function costMicroUsd(model: string, usage: TokenUsage): number {
  const r = ratesForModel(model);
  const usd =
    (usage.inputTokens * r.inputPerMTok +
      usage.cacheWriteTokens * r.cacheWritePerMTok +
      usage.cacheReadTokens * r.cacheReadPerMTok +
      usage.outputTokens * r.outputPerMTok) /
    1_000_000;
  return Math.round(usd * 1_000_000);
}
