/**
 * Engine surface (SPEC 22): score(snapshot) => { result, canonicalBytes }.
 * Pure, no I/O, no wall clock. `canonicalBytes` is produced by canonicalJson
 * over a FixedNum-leaf tree; `result` is exactly JSON.parse(canonicalBytes),
 * so the two are byte-consistent by construction rather than by convention.
 *
 * Scope decision (SPEC 8, 11.8, recorded in docs/NOTES-track-b.md):
 * validations and commerce do not feed the weighted-sum estimator in v0.1.
 * SPEC 8 explicitly warns not to build scoring dependencies on the
 * Validation Registry's current (unstable) shape, and no section of SPEC 11
 * gives a concrete formula for folding either into n_eff. Both still affect
 * lifecycle classification (11.7, via last-activity) and are reported as
 * coverage signals (validation_record_count, commerce_corroborated_reviews).
 * Commerce already enters reviewer weighting today through
 * ReviewerSnapshot.has_commerce_with_agent (SPEC 11.2).
 */
import type {
  AgentSnapshot,
  CanonicalValue,
  FeedbackEntry,
  ReviewerSnapshot,
  ScoreResult,
} from "@trust-index/types";
import { FixedNum, PRECISION, SUPPRESSION_REASONS, canonicalJson, divRoundHalfUp, rescale } from "@trust-index/types";
import { parseConstants, type ConstantsFx } from "./constants.js";
import { resolveEpoch, inCurrentEpoch } from "./epochs.js";
import { capAndSum, posterior, type PosteriorFx, type WeightedObservation } from "./estimator.js";
import { INNER, ONE, divFx, mulFx, parseFx, pow2NegFx } from "./fixedmath.js";
import { inputsHash } from "./hash.js";
import { classifyLifecycle } from "./lifecycle.js";
import { normalizeValue } from "./normalize.js";
import { commonFunderShare, reviewerCohortSameDayShare } from "./signals.js";
import { coverageTier } from "./tiers.js";
import { floorDaysBetween, parseIsoUtcSeconds } from "./time.js";
import { computeReviewerWeights, type ReviewerWeightFx } from "./weights.js";

/** Convert an INNER-scaled [0,1] value to the 0-100 display scale at PRECISION.score. */
function displayScore(valueFx: bigint): FixedNum {
  return new FixedNum(rescale(valueFx * 100n, INNER, PRECISION.score), PRECISION.score);
}

/** Convert an INNER-scaled value to a display FixedNum at the given precision, no rescale of magnitude. */
function displayAt(valueFx: bigint, precision: number): FixedNum {
  return new FixedNum(rescale(valueFx, INNER, precision), precision);
}

export type GroupResult = {
  neffFx: bigint;
  post: PosteriorFx;
  feedbackCount: number;
  unusableCount: number;
  distinctCounterparties: number;
  spanDays: number;
  suppressed: boolean;
};

/**
 * Score one grouping (a single context, or the global pool) of current-epoch,
 * non-revoked feedback entries. `entries` must already be filtered to the
 * grouping and to the current epoch.
 */
export function scoreGroup(
  entries: FeedbackEntry[],
  priorFx: bigint,
  c: ConstantsFx,
  asOfSec: number,
  undecayedWeightByAddress: ReadonlyMap<string, bigint>,
  forceSuppressed: boolean,
): GroupResult {
  const observations: WeightedObservation[] = [];
  let unusableCount = 0;
  const usableAddresses = new Set<string>();
  let minSec = 0;
  let maxSec = 0;
  let haveAny = false;

  for (const entry of entries) {
    const valueFx = normalizeValue(entry);
    if (valueFx === null) {
      unusableCount += 1;
      continue;
    }
    const entrySec = parseIsoUtcSeconds(entry.ts);
    const ageSeconds = asOfSec >= entrySec ? asOfSec - entrySec : 0;
    const ageDaysFx = divRoundHalfUp(BigInt(ageSeconds) * ONE, 86400n);
    const exponentFx = divFx(ageDaysFx, c.decayHalfLifeDays);
    const decayFx = pow2NegFx(exponentFx);
    const reviewerWeightFx = undecayedWeightByAddress.get(entry.client_address);
    if (reviewerWeightFx === undefined) {
      throw new Error(`no reviewer weight computed for ${entry.client_address}`);
    }
    observations.push({
      address: entry.client_address,
      effectiveWeightFx: mulFx(reviewerWeightFx, decayFx),
      valueFx,
    });
    usableAddresses.add(entry.client_address);
    if (!haveAny || entrySec < minSec) minSec = entrySec;
    if (!haveAny || entrySec > maxSec) maxSec = entrySec;
    haveAny = true;
  }

  const sums = capAndSum(observations, undecayedWeightByAddress);
  const post = posterior(sums, priorFx, c.shrinkageK);
  const spanDays = haveAny ? floorDaysBetween(maxSec, minSec) : 0;
  const suppressed = forceSuppressed || sums.neffFx < c.suppressionNeffFloor;

  return {
    neffFx: sums.neffFx,
    post,
    feedbackCount: entries.length,
    unusableCount,
    distinctCounterparties: usableAddresses.size,
    spanDays,
    suppressed,
  };
}

function contextCanonical(group: GroupResult, c: ConstantsFx): CanonicalValue {
  return {
    score: group.suppressed ? null : displayScore(group.post.meanFx),
    score_low: group.suppressed ? null : displayScore(group.post.lowFx),
    score_high: group.suppressed ? null : displayScore(group.post.highFx),
    confidence: displayAt(group.post.confidenceFx, PRECISION.confidence),
    n_eff: displayAt(group.neffFx, PRECISION.n_eff),
    coverage_tier: coverageTier(
      {
        neffFx: group.neffFx,
        spanDays: group.spanDays,
        distinctCounterparties: group.distinctCounterparties,
        suppressed: group.suppressed,
      },
      {
        thinNeffMax: c.thinNeffMax,
        moderateNeffMax: c.moderateNeffMax,
        strongMinSpanDays: c.strongMinSpanDays,
        strongMinCounterparties: c.strongMinCounterparties,
      },
    ),
    feedback_count: group.feedbackCount,
    unusable_feedback_count: group.unusableCount,
  };
}

function reviewerWeightsCanonical(weights: ReviewerWeightFx[]): CanonicalValue {
  return weights.map((w) => ({
    address: w.address,
    weight: displayAt(w.weightFx, PRECISION.weight),
    components: {
      age: displayAt(w.components.age, PRECISION.weight),
      cohort: displayAt(w.components.cohort, PRECISION.weight),
      funder: displayAt(w.components.funder, PRECISION.weight),
      velocity: displayAt(w.components.velocity, PRECISION.weight),
      repeat: displayAt(w.components.repeat, PRECISION.weight),
      commerce: displayAt(w.components.commerce, PRECISION.weight),
      portfolio: displayAt(w.components.portfolio, PRECISION.weight),
    },
  }));
}

export function score(snapshot: AgentSnapshot): { result: ScoreResult; canonicalBytes: string } {
  const c = parseConstants(snapshot.constants);
  const asOfSec = parseIsoUtcSeconds(snapshot.as_of_ts);
  const epochInfo = resolveEpoch(snapshot);

  // Lifecycle activity window is not epoch-scoped (SPEC 11.7 does not say
  // "current epoch"; an agent stays observably live across a benign or
  // hostile ownership change either way). Recorded in docs/NOTES-track-b.md.
  let lastActivitySec: number | null = null;
  for (const f of snapshot.feedback) {
    const t = parseIsoUtcSeconds(f.ts);
    if (lastActivitySec === null || t > lastActivitySec) lastActivitySec = t;
  }
  for (const v of snapshot.validations) {
    const t = parseIsoUtcSeconds(v.ts);
    if (lastActivitySec === null || t > lastActivitySec) lastActivitySec = t;
  }
  for (const m of snapshot.commerce) {
    const t = parseIsoUtcSeconds(m.ts);
    if (lastActivitySec === null || t > lastActivitySec) lastActivitySec = t;
  }

  const lifecycleState = classifyLifecycle(
    {
      metadataStatus: snapshot.metadata_status,
      declaredEndpoints: snapshot.declared_endpoints,
      agentWalletActive: snapshot.agent_wallet_active,
      lastActivitySec,
      asOfSec,
    },
    { liveWindowDays: c.liveWindowDays, dormantWindowDays: c.dormantWindowDays },
  );
  const forceSuppressed = lifecycleState === "placeholder";

  // Current-epoch, non-revoked feedback: the only feedback the estimator or
  // reviewer weighting ever sees (SPEC 11.6: score current-epoch only).
  const currentEpochFeedback = snapshot.feedback.filter(
    (f) => inCurrentEpoch(f.block, epochInfo) && !f.is_revoked,
  );

  const reviewerAddresses = [...new Set(currentEpochFeedback.map((f) => f.client_address))].sort();
  const reviewCountByAddress = new Map<string, number>();
  for (const f of currentEpochFeedback) {
    reviewCountByAddress.set(f.client_address, (reviewCountByAddress.get(f.client_address) ?? 0) + 1);
  }
  const reviewerSnapshots: ReviewerSnapshot[] = reviewerAddresses.map((address) => {
    const r = snapshot.reviewers[address];
    if (r === undefined) {
      throw new Error(`snapshot.reviewers is missing an entry for current-epoch reviewer ${address}`);
    }
    return r;
  });
  const reviewerWeights = computeReviewerWeights(reviewerSnapshots, reviewCountByAddress, asOfSec, c);
  const undecayedWeightByAddress = new Map(reviewerWeights.map((w) => [w.address, w.weightFx]));

  const priorGlobalFx = parseFx(snapshot.priors.global);
  const globalGroup = scoreGroup(currentEpochFeedback, priorGlobalFx, c, asOfSec, undecayedWeightByAddress, forceSuppressed);

  const tags = [...new Set(currentEpochFeedback.map((f) => f.tag1))].sort();
  const scoresByContext: Record<string, CanonicalValue> = {};
  for (const tag of tags) {
    const entries = currentEpochFeedback.filter((f) => f.tag1 === tag);
    const priorStr = snapshot.priors.by_context[tag] ?? snapshot.priors.global;
    const group = scoreGroup(entries, parseFx(priorStr), c, asOfSec, undecayedWeightByAddress, forceSuppressed);
    scoresByContext[tag] = contextCanonical(group, c);
  }

  let suppressionReason: string | null = null;
  if (forceSuppressed) {
    suppressionReason = SUPPRESSION_REASONS.placeholder;
  } else if (globalGroup.feedbackCount > 0 && globalGroup.feedbackCount === globalGroup.unusableCount) {
    suppressionReason = SUPPRESSION_REASONS.no_usable_feedback;
  } else if (globalGroup.suppressed) {
    suppressionReason = SUPPRESSION_REASONS.neff_below_floor;
  }

  const epochStartSec = epochInfo.epochStartSec;
  const effectiveHistoryDays = floorDaysBetween(asOfSec, epochStartSec);

  const cohortShareFx = reviewerCohortSameDayShare(reviewerSnapshots, c.cohortWindowSeconds);
  const funderShareFx = commonFunderShare(reviewerSnapshots);
  const commerceCorroboratedReviews = reviewerSnapshots.filter((r) => r.has_commerce_with_agent).length;

  const signals: Record<string, CanonicalValue> = {
    reviewer_cohort_same_day: displayAt(cohortShareFx, PRECISION.signal),
    common_funder_share: displayAt(funderShareFx, PRECISION.signal),
    distinct_counterparties: globalGroup.distinctCounterparties,
    feedback_span_days: globalGroup.spanDays,
    pre_transfer_reputation_excluded: epochInfo.epoch > 0,
    ownership_transferred_at: epochInfo.lastResetTs,
    custody_migration_detected: epochInfo.custodyMigrationDetected,
    unusable_feedback_count: globalGroup.unusableCount,
    validation_record_count: snapshot.validations.length,
    commerce_corroborated_reviews: commerceCorroboratedReviews,
  };

  const tree: CanonicalValue = {
    methodology_version: snapshot.constants.methodology_version,
    computed_at: snapshot.as_of_ts,
    as_of_block: snapshot.as_of_block,

    score: globalGroup.suppressed ? null : displayScore(globalGroup.post.meanFx),
    score_low: globalGroup.suppressed ? null : displayScore(globalGroup.post.lowFx),
    score_high: globalGroup.suppressed ? null : displayScore(globalGroup.post.highFx),
    confidence: displayAt(globalGroup.post.confidenceFx, PRECISION.confidence),
    n_eff: displayAt(globalGroup.neffFx, PRECISION.n_eff),

    coverage_tier: coverageTier(
      {
        neffFx: globalGroup.neffFx,
        spanDays: globalGroup.spanDays,
        distinctCounterparties: globalGroup.distinctCounterparties,
        suppressed: globalGroup.suppressed,
      },
      {
        thinNeffMax: c.thinNeffMax,
        moderateNeffMax: c.moderateNeffMax,
        strongMinSpanDays: c.strongMinSpanDays,
        strongMinCounterparties: c.strongMinCounterparties,
      },
    ),
    lifecycle_state: lifecycleState,
    suppression_reason: suppressionReason,

    scores_by_context: scoresByContext,
    ownership_epoch: epochInfo.epoch,
    effective_history_days: effectiveHistoryDays,

    signals,
    reviewer_weights: reviewerWeightsCanonical(reviewerWeights),
    inputs_hash: inputsHash(snapshot),
  };

  const canonicalBytes = canonicalJson(tree);
  const result = JSON.parse(canonicalBytes) as ScoreResult;
  return { result, canonicalBytes };
}
