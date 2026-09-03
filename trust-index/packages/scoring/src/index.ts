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
  PriorSet,
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

const ALLOWED_PRIOR_BASES: ReadonlySet<PriorSet["basis"]> = new Set([
  "high_weight_weighted_mean",
  "commerce_corroborated",
]);

/**
 * The engine trusts the prior by architecture: SPEC 11.0 requires it be
 * computed from high-weight evidence only (a raw population mean would launder
 * the sybil inflation the estimator exists to resist), and the engine cannot
 * recompute it from a single snapshot. It can, and does, refuse a prior that
 * fails the provenance the PriorSet type promises: an unknown basis or a
 * non-positive n_basis fails closed rather than silently shrinking every thin
 * agent toward an unvouched number. The prior's basis and n_basis are folded
 * into inputs_hash, so a reproducer sees exactly which prior was used.
 */
function assertValidPrior(priors: PriorSet): void {
  if (!ALLOWED_PRIOR_BASES.has(priors.basis)) {
    throw new Error(`prior basis is not an allowed provenance: ${JSON.stringify(priors.basis)}`);
  }
  if (parseFx(priors.n_basis) <= 0n) {
    throw new Error(`prior n_basis must be positive, got ${JSON.stringify(priors.n_basis)}`);
  }
  // A prior is a probability on the normalized scale: it must lie in [0,1].
  // Out-of-range values would push the Beta posterior alpha or beta negative.
  const inUnit = (label: string, s: string): void => {
    const v = parseFx(s);
    if (v < 0n || v > ONE) throw new Error(`prior ${label} must be in [0,1], got ${JSON.stringify(s)}`);
  };
  inUnit("global", priors.global);
  for (const [k, v] of Object.entries(priors.by_context)) inUnit(`by_context[${k}]`, v);
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
    // Revoked feedback is not activity: an agent whose entire history was
    // revoked is not "live" on the strength of the revoked rows (SPEC 11.7).
    if (f.is_revoked) continue;
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
  // Dedupe by the feedback primary key (client_address, feedback_index) before
  // anything counts it: a duplicated row must not earn a second repeat-interaction
  // bonus or a second decayed contribution. The db enforces this key, so a
  // duplicate here is a malformed snapshot; keep the first occurrence.
  const seenFeedbackKeys = new Set<string>();
  const currentEpochFeedback = snapshot.feedback.filter((f) => {
    if (!inCurrentEpoch(f.block, epochInfo) || f.is_revoked) return false;
    const key = `${f.client_address}#${f.feedback_index}`;
    if (seenFeedbackKeys.has(key)) return false;
    seenFeedbackKeys.add(key);
    return true;
  });

  const reviewerAddresses = [...new Set(currentEpochFeedback.map((f) => f.client_address))].sort();
  const reviewCountByAddress = new Map<string, number>();
  for (const f of currentEpochFeedback) {
    reviewCountByAddress.set(f.client_address, (reviewCountByAddress.get(f.client_address) ?? 0) + 1);
  }
  // A reviewer with feedback but no stats row can occur under the spec's own
  // cadence mismatch (feedback polled every 30s, reviewer aggregates refreshed
  // daily). Rather than throw and drop the whole agent onto the non-authoritative
  // fallback, synthesize the most conservative reviewer possible (age 0 so the
  // age multiplier sits at its floor, maximum portfolio concentration, no
  // corroboration) and surface the count as a signal.
  let synthesizedReviewerCount = 0;
  const reviewerSnapshots: ReviewerSnapshot[] = reviewerAddresses.map((address) => {
    // Own-key check, not a bracket read: an address equal to an inherited
    // member ("__proto__") must take the synthesize path, not return the
    // prototype object. Consistent with the by_context lookup above.
    if (Object.hasOwn(snapshot.reviewers, address)) return snapshot.reviewers[address]!;
    synthesizedReviewerCount += 1;
    return {
      address: address as ReviewerSnapshot["address"],
      first_seen_block: snapshot.as_of_block,
      first_seen_ts: snapshot.as_of_ts,
      total_reviews: 1,
      distinct_agents_reviewed: 1,
      max_reviews_single_day: 1,
      funder_address: null,
      portfolio_top_funder_share: "1.000000",
      has_commerce_with_agent: false,
    };
  });
  const reviewerWeights = computeReviewerWeights(reviewerSnapshots, reviewCountByAddress, asOfSec, c);
  const undecayedWeightByAddress = new Map(reviewerWeights.map((w) => [w.address, w.weightFx]));

  assertValidPrior(snapshot.priors);
  const priorGlobalFx = parseFx(snapshot.priors.global);
  const globalGroup = scoreGroup(currentEpochFeedback, priorGlobalFx, c, asOfSec, undecayedWeightByAddress, forceSuppressed);

  const tags = [...new Set(currentEpochFeedback.map((f) => f.tag1))].sort();
  // Null-prototype so a tag1 equal to an inherited member ("__proto__") is
  // stored as an own key and cannot invoke a prototype setter that would drop
  // the context from the canonical output.
  const scoresByContext: Record<string, CanonicalValue> = Object.create(null);
  for (const tag of tags) {
    const entries = currentEpochFeedback.filter((f) => f.tag1 === tag);
    // Object.hasOwn, not `by_context[tag] ?? global`: tag1 is decoded verbatim
    // from the on-chain feedback event, so a tag equal to an inherited object
    // member ("__proto__", "toString") would otherwise resolve to a prototype
    // value and drive parseFx to throw. Own-key lookup only.
    const priorStr = Object.hasOwn(snapshot.priors.by_context, tag)
      ? snapshot.priors.by_context[tag]!
      : snapshot.priors.global;
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

  // Clamp a future epoch start (a registered_at or transfer ts dated after
  // as_of_ts, from clock skew or a malformed snapshot) to a zero history rather
  // than throwing, matching the decay and lifecycle clamps. floorDaysBetween
  // requires a >= b.
  const epochStartSec = epochInfo.epochStartSec;
  const effectiveHistoryDays = asOfSec >= epochStartSec ? floorDaysBetween(asOfSec, epochStartSec) : 0;

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
    synthesized_reviewer_count: synthesizedReviewerCount,
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

/**
 * Re-exported for the calibration harness so the raw-mean baseline uses the
 * engine's own normalization rather than a second copy of the SPEC 11.10 rule
 * that could drift from it. Not part of the serving path.
 */
export { normalizeValue } from "./normalize.js";
