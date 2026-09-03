/**
 * Predictors under evaluation (SPEC 12.5).
 *
 * A predictor maps a pre-split snapshot to a probability in [0,1] that the
 * agent's next job completes cleanly. The index's own score is one predictor;
 * the rest are the deliberately trivial baselines the spec insists we report
 * against: "If we cannot beat 'count the reviews,' we have built nothing and
 * must say so."
 *
 * The baselines are given their best shot rather than a strawman reading:
 * count and age are cohort-normalized to [0,1] (each gets full credit for its
 * rank within the evaluated set), which is the most generous monotone mapping
 * available without fitting a model to the labels.
 */
import type { AgentSnapshot } from "@trust-index/types";
import { normalizeValue, score } from "@trust-index/scoring";
import { ONE, clamp, parse, ratio } from "./fixed.js";

export type PredictorOutput = {
  /** SCALE-scaled probability in [0,1]. */
  pFx: bigint;
  /** Coverage tier for the per-tier breakdown, when the predictor has one. */
  tier?: string;
};

export type Predictor = {
  name: string;
  description: string;
  /**
   * Cohort-level prediction. Predictors that need cohort normalization (count,
   * age) see every snapshot at once; per-agent predictors ignore the cohort.
   */
  predict(cohort: readonly AgentSnapshot[]): PredictorOutput[];
};

function parseTs(ts: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})Z$/.exec(ts);
  if (m === null) throw new SyntaxError(`not an ISO-8601 UTC timestamp: ${JSON.stringify(ts)}`);
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]), Number(m[6])) / 1000;
}

/** Normalize a set of non-negative integer magnitudes to [0,1] by the cohort maximum. */
function normalizeByMax(values: readonly bigint[]): bigint[] {
  let max = 0n;
  for (const v of values) if (v > max) max = v;
  if (max === 0n) return values.map(() => 0n);
  return values.map((v) => ratio(v, max));
}

/**
 * The index's own score, mapped to a probability.
 *
 * The score is a 0-100 quality estimate, not a probability of clean
 * completion, so it is read as p = score/100. That is the identity mapping a
 * consumer implicitly assumes when gating on `minimum_score`, which makes it
 * the honest thing to evaluate: if the mapping is wrong, the reliability curve
 * is exactly where that shows up.
 *
 * A suppressed score (null) has no estimate to offer. Rather than inventing
 * one, the agent falls back to the cohort prior carried on its own snapshot,
 * which is what a consumer reading "no score" should assume.
 */
export const indexScorePredictor: Predictor = {
  name: "index_score",
  description: "The Agent Trust Index posterior score, read as p = score/100.",
  predict(cohort) {
    return cohort.map((snapshot) => {
      const { result } = score(snapshot);
      if (result.score === null) {
        return { pFx: clamp(parse(snapshot.priors.global), 0n, ONE), tier: result.coverage_tier };
      }
      const pFx = ratio(BigInt(Math.round(result.score * 100)), 10_000n);
      return { pFx: clamp(pFx, 0n, ONE), tier: result.coverage_tier };
    });
  },
};

/**
 * Raw mean of normalized feedback, unweighted and undecayed: the naive score
 * every surveyed competitor effectively publishes.
 */
export const rawMeanPredictor: Predictor = {
  name: "raw_mean",
  description: "Unweighted, undecayed mean of normalized feedback values.",
  predict(cohort) {
    return cohort.map((snapshot) => {
      let sum = 0n;
      let n = 0n;
      for (const f of snapshot.feedback) {
        if (f.is_revoked) continue;
        const v = normalizeValue(f);
        if (v === null) continue;
        sum += v;
        n += 1n;
      }
      if (n === 0n) return { pFx: clamp(parse(snapshot.priors.global), 0n, ONE) };
      return { pFx: clamp(sum / n, 0n, ONE) };
    });
  },
};

/** Review count alone, cohort-normalized. "Count the reviews." */
export const reviewCountPredictor: Predictor = {
  name: "review_count",
  description: "Number of usable reviews, normalized to [0,1] by the cohort maximum.",
  predict(cohort) {
    const counts = cohort.map((s) => BigInt(s.feedback.filter((f) => !f.is_revoked).length));
    return normalizeByMax(counts).map((pFx) => ({ pFx }));
  },
};

/** Wallet age alone, cohort-normalized. The signal competitors treat as uncheatable. */
export const walletAgePredictor: Predictor = {
  name: "wallet_age",
  description: "Agent registration age in days, normalized to [0,1] by the cohort maximum.",
  predict(cohort) {
    const ages = cohort.map((s) => {
      const days = Math.floor((parseTs(s.as_of_ts) - parseTs(s.registered_at)) / 86_400);
      return BigInt(Math.max(0, days));
    });
    return normalizeByMax(ages).map((pFx) => ({ pFx }));
  },
};

/** Every predictor the calibration report compares, model first. */
export const ALL_PREDICTORS: readonly Predictor[] = [
  indexScorePredictor,
  rawMeanPredictor,
  reviewCountPredictor,
  walletAgePredictor,
];
