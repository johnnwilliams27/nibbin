/**
 * Routing Reinforcement — Slice B policy (§4B/§7 "thin owned reinforcement
 * over the bought gateway"). A DETERMINISTIC, side-effect-free weighting that
 * shifts traffic among PRE-VETTED candidates by quality-within-budget with a
 * min-volume floor. NOT ML — same inputs always give the same model.
 *
 * Invariants the whole slice rests on:
 *  1. The candidate set IS the eval-cleared allowlist. `chooseModel` only ever
 *     returns a member of `candidates`; it can never name an unvetted model.
 *  2. The FIRST candidate is the safe default (route()'s static choice). With
 *     one candidate, OR no performance source, OR insufficient/absent data,
 *     `chooseModel` returns `candidates[0]` — byte-for-byte today's behavior.
 *  3. Reinforcement only DIVERGES from candidates[0] when there are ≥2
 *     candidates AND the data clears the min-volume floor AND a different
 *     candidate wins on quality-within-budget. The default is always eligible,
 *     so divergence is a deliberate, data-backed swap, never a fallback.
 */
import type { PerfStat, PerformanceSource, ReinforcementParams, RoutedTask, Tier } from './types';

/** A candidate paired with its measured performance (undefined ⇒ no data). */
interface Scored {
  model: string;
  /** Position in the ordered candidate set; 0 is the configured default. */
  rank: number;
  perf: PerfStat | undefined;
}

/**
 * Pick one model from an ordered candidate set by quality-within-budget.
 *
 * @param candidates ordered allowlist; candidates[0] is the configured default
 *                   and the guaranteed fallback. Must be non-empty.
 * @param task       the routed task (for the perf lookup key).
 * @param tier       the tier actually being served (perf is keyed by tier).
 * @param source     the performance snapshot, or undefined (⇒ no reinforcement).
 * @param params     min-volume floor + quality bar + cost tie-break band.
 * @returns          a member of `candidates` — never anything else.
 */
export function chooseModel(
  candidates: readonly string[],
  task: RoutedTask,
  tier: Tier,
  source: PerformanceSource | undefined,
  params: ReinforcementParams,
): string {
  const fallback = candidates[0];
  // One candidate or no data source ⇒ exactly the static choice. This is the
  // no-behavior-change guarantee: every task ships with one candidate today.
  if (candidates.length < 2 || !source) return fallback;

  // De-dupe while preserving order so a config that lists the default twice
  // can't double-count it; the default keeps rank 0.
  const seen = new Set<string>();
  const scored: Scored[] = [];
  for (let i = 0; i < candidates.length; i++) {
    const model = candidates[i];
    if (seen.has(model)) continue;
    seen.add(model);
    scored.push({ model, rank: i, perf: source.getPerformance(model, task, tier) });
  }

  // Min-volume floor — applied to the DEFAULT. The default is the incumbent;
  // if we don't even have enough decided data on it, the window is too cold to
  // trust any reweighting, so we hold the static choice. (We still require each
  // CHALLENGER to clear the floor below before it can win — a thin challenger
  // never unseats the incumbent.)
  const def = scored[0];
  if (!def.perf || def.perf.decidedCalls < params.minDecidedCalls) return fallback;

  // Eligibility: a candidate is in the running only if it has enough decided
  // data, clears the quality bar, and is not churning (refusal/error spike).
  // The default is always evaluated on the same terms; it already cleared the
  // volume floor above, but it must still clear the quality/churn gates — if
  // the incumbent itself is failing those, we want to be able to move off it.
  const eligible = scored.filter(
    (s) =>
      s.perf !== undefined &&
      s.perf.decidedCalls >= params.minDecidedCalls &&
      s.perf.approvedUneditedRate >= params.qualityBar &&
      s.perf.refusalErrorRate <= params.maxRefusalErrorRate,
  );

  // Nobody (not even the default) is eligible ⇒ hold the static choice.
  if (eligible.length === 0) return fallback;

  // Best achievable quality among the eligible.
  let bestRate = 0;
  for (const s of eligible) bestRate = Math.max(bestRate, s.perf!.approvedUneditedRate);

  // P8 cost-aware selection: among candidates whose quality is within the
  // tolerance band of the best (i.e. "as good" inside the noise), prefer the
  // CHEAPEST. Ties on cost break toward the lower rank (the default first),
  // so an equal-quality, equal-cost field never moves traffic off the default.
  const asGood = eligible.filter((s) => bestRate - s.perf!.approvedUneditedRate <= params.qualityTolerance);

  let winner = asGood[0];
  for (const s of asGood) {
    const cheaper = s.perf!.avgCostMicroUsd < winner.perf!.avgCostMicroUsd;
    const sameCostLowerRank =
      s.perf!.avgCostMicroUsd === winner.perf!.avgCostMicroUsd && s.rank < winner.rank;
    if (cheaper || sameCostLowerRank) winner = s;
  }
  return winner.model;
}
