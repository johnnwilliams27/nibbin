/**
 * SYNTHETIC FALLBACK ONLY. Not the scoring engine.
 *
 * @trust-index/scoring (Track B) is the sole authority on ScoreResult values;
 * this module exists so the surface renders something honest when that
 * package is absent or incomplete (see scoring-port.ts). It implements the
 * public formulas from SPEC 11.0/11.1 in plain JS numbers, not the
 * determinism-grade fixed-point path SPEC 22 requires of the real engine.
 * Every result this module produces carries `signals.engine_source =
 * "synthetic_fallback"` so nothing downstream can mistake it for a real
 * score. It is never used to compute an anchored or on-chain value.
 *
 * Reviewer-weight component formulas here are this module's own reasonable
 * reading of SPEC 11.2, not a copy of Track B's implementation; they exist
 * to produce plausible, internally consistent numbers for rendering and
 * local testing, not to reproduce the real engine byte-for-byte (D1 skips
 * that comparison whenever this fallback is in use).
 */
import {
  SUPPRESSION_REASONS,
  type AgentSnapshot,
  type ContextScore,
  type CoverageTier,
  type FeedbackEntry,
  type LifecycleState,
  type MethodologyConstants,
  type ReviewerWeightEntry,
  type ScoreResult,
} from "@trust-index/types";

const DAY_MS = 86_400_000;
const Z95 = 1.96;

function num(s: string): number {
  return Number(s);
}

function daysBetween(a: string, b: string): number {
  return (new Date(b).getTime() - new Date(a).getTime()) / DAY_MS;
}

type ReviewerComponents = ReviewerWeightEntry["components"];

type ReviewerCtx = {
  address: string;
  weight: number;
  components: ReviewerComponents;
};

type UsableEntry = {
  entry: FeedbackEntry;
  address: string;
  valueNormalized: number;
  ageDays: number;
};

/** Determine the current ownership epoch and the timestamp it began at. */
function resolveEpoch(snapshot: AgentSnapshot): {
  epoch: number;
  epochStartTs: string;
  transferredAt: string | null;
  custodyMigrationDetected: boolean;
} {
  let epoch = 0;
  let epochStartTs = snapshot.registered_at;
  let transferredAt: string | null = null;
  let custodyMigrationDetected = false;

  snapshot.transfers.forEach((t, i) => {
    const linkage = snapshot.transfer_linkages.find((l) => l.transfer_index === i);
    const benign = Boolean(linkage && (linkage.same_funder || linkage.bidirectional_history));
    if (benign) {
      custodyMigrationDetected = true;
      return;
    }
    epoch += 1;
    epochStartTs = t.ts;
    transferredAt = t.ts;
  });

  return { epoch, epochStartTs, transferredAt, custodyMigrationDetected };
}

function classifyLifecycle(
  snapshot: AgentSnapshot,
  constants: MethodologyConstants,
): LifecycleState {
  const metadataResolved = snapshot.metadata_status === "resolved";
  const hasEndpoints = snapshot.declared_endpoints > 0;
  const anyActivity =
    snapshot.feedback.length > 0 || snapshot.validations.length > 0 || snapshot.commerce.length > 0;

  if (!metadataResolved && !hasEndpoints && snapshot.feedback.length === 0 && !snapshot.agent_wallet_active) {
    return "placeholder";
  }
  if (!anyActivity) return "registered";

  const lastActivityTs = [
    ...snapshot.feedback.map((f) => f.ts),
    ...snapshot.validations.map((v) => v.ts),
    ...snapshot.commerce.map((c) => c.ts),
  ].sort()
    .at(-1)!;

  const daysSince = daysBetween(lastActivityTs, snapshot.as_of_ts);
  const liveWindow = num(constants.lifecycle.live_window_days.value);
  return daysSince <= liveWindow ? "live" : "dormant";
}

/** Cluster reviewers by first_seen proximity; returns the largest cluster's share of reviewers. */
function cohortShare(
  reviewerAddresses: string[],
  reviewers: AgentSnapshot["reviewers"],
  windowHours: number,
): number {
  if (reviewerAddresses.length === 0) return 0;
  const sorted = [...reviewerAddresses].sort(
    (a, b) => new Date(reviewers[a]!.first_seen_ts).getTime() - new Date(reviewers[b]!.first_seen_ts).getTime(),
  );
  let bestCluster = 1;
  let clusterStart = 0;
  for (let i = 1; i < sorted.length; i++) {
    const prevTs = new Date(reviewers[sorted[i - 1]!]!.first_seen_ts).getTime();
    const curTs = new Date(reviewers[sorted[i]!]!.first_seen_ts).getTime();
    const hoursGap = (curTs - prevTs) / (3600 * 1000);
    if (hoursGap > windowHours) {
      clusterStart = i;
    }
    bestCluster = Math.max(bestCluster, i - clusterStart + 1);
  }
  return bestCluster / sorted.length;
}

function commonFunderShare(reviewerAddresses: string[], reviewers: AgentSnapshot["reviewers"]): number {
  if (reviewerAddresses.length === 0) return 0;
  const counts = new Map<string, number>();
  for (const addr of reviewerAddresses) {
    const funder = reviewers[addr]?.funder_address;
    if (!funder) continue;
    counts.set(funder, (counts.get(funder) ?? 0) + 1);
  }
  const max = Math.max(0, ...counts.values());
  return max / reviewerAddresses.length;
}

function reviewerWeight(
  address: string,
  snapshot: AgentSnapshot,
  reviewCountForAgent: number,
  largestFunderGroupSize: number,
  cohortShareForReviewer: number,
  constants: MethodologyConstants,
): ReviewerCtx {
  const r = snapshot.reviewers[address]!;
  const w = constants.weight;

  const ageDays = Math.max(0, daysBetween(r.first_seen_ts, snapshot.as_of_ts));
  const ageRamp = num(w.age_ramp_days.value);
  const ageFloor = num(w.age_floor.value);
  const age = Math.min(1, ageFloor + (1 - ageFloor) * (ageDays / ageRamp));

  const cohort = 1 - cohortShareForReviewer * num(w.cohort_penalty.value);

  const funder = largestFunderGroupSize >= 2 ? num(w.common_funder_multiplier.value) : 1;

  const velocityThreshold = num(w.velocity_threshold_per_day.value);
  const velocity = r.max_reviews_single_day > velocityThreshold ? num(w.velocity_multiplier.value) : 1;

  const repeatMultiplier = num(w.repeat_bonus_multiplier.value);
  const repeatCap = num(w.repeat_bonus_cap.value);
  const repeat =
    reviewCountForAgent > 1
      ? Math.min(repeatCap, Math.pow(repeatMultiplier, reviewCountForAgent - 1))
      : 1;

  const commerce = r.has_commerce_with_agent ? num(w.commerce_multiplier.value) : 1;

  const portfolioShare = num(r.portfolio_top_funder_share);
  const portfolioPenalty = num(w.portfolio_penalty.value);
  const portfolio = 1 - portfolioShare * (1 - portfolioPenalty);

  const weightFloor = num(w.weight_floor.value);
  const raw = age * cohort * funder * velocity * repeat * commerce * portfolio;
  const weight = Math.min(1, Math.max(weightFloor, raw));

  return { address, weight, components: { age, cohort, funder, velocity, repeat, commerce, portfolio } };
}

/** Per-reviewer decay-weighted sum, capped at the reviewer's undecayed weight (SPEC 11.4, per estimator.ts note). */
function aggregate(
  entries: UsableEntry[],
  weightByAddress: Map<string, number>,
  halfLifeDays: number,
): { nEff: number; sumWV: number } {
  const byAddress = new Map<string, UsableEntry[]>();
  for (const e of entries) {
    const list = byAddress.get(e.address);
    if (list) list.push(e);
    else byAddress.set(e.address, [e]);
  }
  let nEff = 0;
  let sumWV = 0;
  for (const [address, list] of byAddress) {
    const w = weightByAddress.get(address) ?? 0;
    let s = 0;
    let sv = 0;
    for (const e of list) {
      const decay = Math.pow(2, -e.ageDays / halfLifeDays);
      const eff = w * decay;
      s += eff;
      sv += eff * e.valueNormalized;
    }
    if (s > w && s > 0) {
      sv = (sv * w) / s;
      s = w;
    }
    nEff += s;
    sumWV += sv;
  }
  return { nEff, sumWV };
}

type Posterior = {
  score: number;
  scoreLow: number;
  scoreHigh: number;
  confidence: number;
};

function posterior(sumW: number, sumWV: number, prior: number, k: number): Posterior {
  const alpha = k * prior + sumWV;
  const beta = k * (1 - prior) + (sumW - sumWV);
  const total = alpha + beta;
  const m = total > 0 ? alpha / total : prior;
  const variance = total > 0 ? (m * (1 - m)) / (total + 1) : 0;
  const halfWidth = Z95 * Math.sqrt(Math.max(0, variance));
  const width = 2 * halfWidth;

  const alpha0 = k * prior;
  const beta0 = k * (1 - prior);
  const total0 = alpha0 + beta0;
  const m0 = total0 > 0 ? alpha0 / total0 : prior;
  const variance0 = total0 > 0 ? (m0 * (1 - m0)) / (total0 + 1) : 0;
  const width0 = 2 * Z95 * Math.sqrt(Math.max(0, variance0));

  const confidence = width0 > 0 ? Math.min(1, Math.max(0, 1 - Math.min(1, width / width0))) : 0;

  return {
    score: m * 100,
    scoreLow: Math.max(0, Math.min(1, m - halfWidth)) * 100,
    scoreHigh: Math.max(0, Math.min(1, m + halfWidth)) * 100,
    confidence,
  };
}

function coverageTier(
  nEff: number,
  spanDays: number,
  distinctCounterparties: number,
  constants: MethodologyConstants,
): CoverageTier {
  const floor = num(constants.suppression_neff_floor.value);
  if (nEff < floor) return "none";
  const thinMax = num(constants.tiers.thin_neff_max.value);
  if (nEff < thinMax) return "thin";
  const moderateMax = num(constants.tiers.moderate_neff_max.value);
  const strongSpan = num(constants.tiers.strong_min_span_days.value);
  const strongCounterparties = num(constants.tiers.strong_min_counterparties.value);
  if (nEff >= moderateMax && spanDays >= strongSpan && distinctCounterparties >= strongCounterparties) {
    return "strong";
  }
  return "moderate";
}

function round(v: number, digits: number): number {
  const f = 10 ** digits;
  return Math.round(v * f) / f;
}

function fakeInputsHash(snapshot: AgentSnapshot): string {
  // Not a canonical hash (SPEC 22 governs the real one). Deterministic and
  // stable across runs of this fallback so tests can rely on it, nothing more.
  let h = 0;
  const s = `${snapshot.chain_slug}:${snapshot.agent_id}:${snapshot.as_of_block}:synthetic`;
  for (let i = 0; i < s.length; i++) {
    h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  }
  return `synthetic${(h >>> 0).toString(16).padStart(8, "0")}`;
}

export function computeSyntheticScoreResult(snapshot: AgentSnapshot): ScoreResult {
  const constants = snapshot.constants;
  const { epoch, epochStartTs, transferredAt, custodyMigrationDetected } = resolveEpoch(snapshot);
  const lifecycleState = classifyLifecycle(snapshot, constants);

  const epochFeedback = snapshot.feedback.filter((f) => f.ts >= epochStartTs && !f.is_revoked);

  const usable: UsableEntry[] = [];
  let unusableCount = 0;
  for (const f of epochFeedback) {
    const scale = f.detected_scale;
    if (!scale) {
      unusableCount += 1;
      continue;
    }
    const min = num(scale.min_raw);
    const max = num(scale.max_raw);
    if (max === min) {
      unusableCount += 1;
      continue;
    }
    const raw = num(f.value_raw);
    const v = Math.max(0, Math.min(1, (raw - min) / (max - min)));
    usable.push({
      entry: f,
      address: f.client_address,
      valueNormalized: v,
      ageDays: Math.max(0, daysBetween(f.ts, snapshot.as_of_ts)),
    });
  }

  const reviewerAddresses = [...new Set(usable.map((u) => u.address))].sort();
  const windowHours = num(constants.weight.cohort_window_hours.value);
  const largestFunderGroupSize = Math.round(
    commonFunderShare(reviewerAddresses, snapshot.reviewers) * reviewerAddresses.length,
  );
  const reviewCountByAddress = new Map<string, number>();
  for (const u of usable) {
    reviewCountByAddress.set(u.address, (reviewCountByAddress.get(u.address) ?? 0) + 1);
  }

  const reviewerContexts: ReviewerCtx[] = reviewerAddresses.map((address) => {
    const share = cohortShare([address, ...reviewerAddresses.filter((a) => a !== address)], snapshot.reviewers, windowHours);
    return reviewerWeight(
      address,
      snapshot,
      reviewCountByAddress.get(address) ?? 1,
      largestFunderGroupSize,
      share,
      constants,
    );
  });
  const weightByAddress = new Map(reviewerContexts.map((r) => [r.address, r.weight]));

  const halfLife = num(constants.decay_half_life_days.value);
  const k = num(constants.shrinkage_k.value);

  const globalAgg = aggregate(usable, weightByAddress, halfLife);
  const globalPost = posterior(globalAgg.nEff, globalAgg.sumWV, num(snapshot.priors.global), k);

  const spanDays =
    usable.length >= 2
      ? daysBetween(
          usable.reduce((a, b) => (a.entry.ts < b.entry.ts ? a : b)).entry.ts,
          usable.reduce((a, b) => (a.entry.ts > b.entry.ts ? a : b)).entry.ts,
        )
      : 0;

  const suppressionFloor = num(constants.suppression_neff_floor.value);
  const suppressed = lifecycleState === "placeholder" || globalAgg.nEff < suppressionFloor;

  let suppressionReason: string | null = null;
  if (lifecycleState === "placeholder") {
    suppressionReason = SUPPRESSION_REASONS.placeholder;
  } else if (suppressed && usable.length === 0 && unusableCount > 0) {
    suppressionReason = SUPPRESSION_REASONS.no_usable_feedback;
  } else if (suppressed) {
    suppressionReason = SUPPRESSION_REASONS.neff_below_floor;
  }

  // Per-context scores.
  const tags = [...new Set(epochFeedback.map((f) => f.tag1))].sort();
  const scoresByContext: Record<string, ContextScore> = {};
  for (const tag of tags) {
    const tagUsable = usable.filter((u) => u.entry.tag1 === tag);
    const tagUnusable = epochFeedback.filter((f) => f.tag1 === tag && !tagUsable.some((u) => u.entry === f)).length;
    const agg = aggregate(tagUsable, weightByAddress, halfLife);
    const prior = num(snapshot.priors.by_context[tag] ?? snapshot.priors.global);
    const contextSuppressed = agg.nEff < suppressionFloor;
    if (contextSuppressed) {
      scoresByContext[tag] = {
        score: null,
        score_low: null,
        score_high: null,
        confidence: 0,
        n_eff: round(agg.nEff, 2),
        coverage_tier: "none",
        feedback_count: tagUsable.length,
        unusable_feedback_count: tagUnusable,
      };
    } else {
      const post = posterior(agg.nEff, agg.sumWV, prior, k);
      const tagSpan =
        tagUsable.length >= 2
          ? daysBetween(
              tagUsable.reduce((a, b) => (a.entry.ts < b.entry.ts ? a : b)).entry.ts,
              tagUsable.reduce((a, b) => (a.entry.ts > b.entry.ts ? a : b)).entry.ts,
            )
          : 0;
      scoresByContext[tag] = {
        score: round(post.score, 2),
        score_low: round(post.scoreLow, 2),
        score_high: round(post.scoreHigh, 2),
        confidence: round(post.confidence, 4),
        n_eff: round(agg.nEff, 2),
        coverage_tier: coverageTier(agg.nEff, tagSpan, new Set(tagUsable.map((u) => u.address)).size, constants),
        feedback_count: tagUsable.length,
        unusable_feedback_count: tagUnusable,
      };
    }
  }

  const reviewerWeights: ReviewerWeightEntry[] = reviewerContexts
    .map((r) => ({ address: r.address as ReviewerWeightEntry["address"], weight: round(r.weight, 4), components: {
      age: round(r.components.age, 4),
      cohort: round(r.components.cohort, 4),
      funder: round(r.components.funder, 4),
      velocity: round(r.components.velocity, 4),
      repeat: round(r.components.repeat, 4),
      commerce: round(r.components.commerce, 4),
      portfolio: round(r.components.portfolio, 4),
    } }))
    .sort((a, b) => (a.address < b.address ? -1 : 1));

  const commerceCorroborated = reviewerAddresses.filter(
    (a) => snapshot.reviewers[a]?.has_commerce_with_agent,
  ).length;

  const result: ScoreResult = {
    methodology_version: constants.methodology_version,
    computed_at: snapshot.as_of_ts,
    as_of_block: snapshot.as_of_block,

    score: suppressed ? null : round(globalPost.score, 2),
    score_low: suppressed ? null : round(globalPost.scoreLow, 2),
    score_high: suppressed ? null : round(globalPost.scoreHigh, 2),
    confidence: suppressed ? 0 : round(globalPost.confidence, 4),
    n_eff: round(globalAgg.nEff, 2),

    coverage_tier: suppressed ? "none" : coverageTier(globalAgg.nEff, spanDays, reviewerAddresses.length, constants),
    lifecycle_state: lifecycleState,
    suppression_reason: suppressionReason,

    scores_by_context: scoresByContext,
    ownership_epoch: epoch,
    effective_history_days: Math.max(0, Math.round(daysBetween(epochStartTs, snapshot.as_of_ts))),

    signals: {
      reviewer_cohort_same_day: round(cohortShare(reviewerAddresses, snapshot.reviewers, windowHours), 4),
      common_funder_share: round(commonFunderShare(reviewerAddresses, snapshot.reviewers), 4),
      distinct_counterparties: reviewerAddresses.length,
      feedback_span_days: round(spanDays, 2),
      pre_transfer_reputation_excluded: epoch > 0,
      ownership_transferred_at: transferredAt,
      custody_migration_detected: custodyMigrationDetected,
      unusable_feedback_count: unusableCount,
      validation_record_count: snapshot.validations.filter((v) => v.ts >= epochStartTs).length,
      commerce_corroborated_reviews: commerceCorroborated,
      engine_source: "synthetic_fallback",
    },
    reviewer_weights: reviewerWeights,
    inputs_hash: fakeInputsHash(snapshot),
  };

  return result;
}
