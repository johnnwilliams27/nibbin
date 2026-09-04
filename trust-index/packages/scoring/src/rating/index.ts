/**
 * Generic rating engine: scoreSubject(subject) => { result, canonicalBytes }.
 *
 * Same contract as score() on the chain path: pure, no I/O, no wall clock,
 * canonical bytes produced from integer math and `result` exactly
 * JSON.parse of them, so the two are byte-consistent by construction.
 *
 * What differs is only what it reads. score() reads an AgentSnapshot and knows
 * about tokens, owners and epochs. scoreSubject() reads a Subject and knows
 * about dimensions and provenance, and it works the same whether the
 * observations came from a chain, from probing an endpoint, or from a code
 * host's API.
 *
 * The two paths share the estimator itself (capAndSum, posterior) rather than
 * reimplementing it. That is deliberate: a second copy of the shrinkage
 * posterior would drift from the first, and then the compendium would be two
 * methodologies wearing one name.
 *
 * Ordering of the pipeline, and why:
 *
 *   1. Drop observations whose dimension the profile does not define. An
 *      unknown dimension is a collector bug, not evidence; it is counted and
 *      reported rather than silently absorbed.
 *   2. Drop observations whose provenance the dimension does not accept. This
 *      is the first gameability gate: reviews are not admissible on a measured
 *      dimension at all.
 *   3. Weight each observer, then decay each observation by age, then apply
 *      the provenance multiplier.
 *   4. Apply the per-dimension self-reported cap, which scales self-reported
 *      contributions down until they hold no more than their allowed share.
 *   5. Apply the per-observer cap (capAndSum) so one observer cannot outvote
 *      the rest by volume.
 *   6. Shrink toward the prior and take the interval.
 *
 * Steps 4 and 5 are separate on purpose. The first bounds one PROVENANCE, the
 * second bounds one OBSERVER, and an attacker who controls both the subject
 * and a pile of review accounts has to get past both.
 */
import type {
  CanonicalValue,
  DimensionSpec,
  Observation,
  Observer,
  RatingCoverageTier,
  RatingLifecycle,
  RatingPriorSet,
  Subject,
  SubjectScoreResult,
} from "@trust-index/types";
import {
  FixedNum,
  PRECISION,
  RATING_SUPPRESSION,
  canonicalJson,
  divRoundHalfUp,
  getRatingProfile,
  rescale,
} from "@trust-index/types";
import { capAndSum, posterior, referenceWidthFx, type WeightedObservation } from "../estimator.js";
import { INNER, ONE, clampFx, divFx, intFx, minFx, mulFx, parseFx, pow2NegFx } from "../fixedmath.js";
import { floorDaysBetween, parseIsoUtcSeconds } from "../time.js";
import { parseRatingConstants, type RatingConstantsFx } from "./constants.js";
import { subjectInputsHash, observationKey } from "./hash.js";
import { computeObserverWeights, type ObserverWeightFx } from "./weights.js";

function displayScore(valueFx: bigint): FixedNum {
  return new FixedNum(rescale(valueFx * 100n, INNER, PRECISION.score), PRECISION.score);
}

function displayAt(valueFx: bigint, precision: number): FixedNum {
  return new FixedNum(rescale(valueFx, INNER, precision), precision);
}

const ALLOWED_PRIOR_BASES: ReadonlySet<RatingPriorSet["basis"]> = new Set([
  "high_weight_weighted_mean",
  "measured_only",
  "commerce_corroborated",
]);

/**
 * Same fail-closed rule as the chain path: the engine cannot recompute a
 * cohort prior from one subject, so it refuses a prior that fails the
 * provenance the type promises rather than shrinking every thin subject toward
 * an unvouched number.
 */
function assertValidPrior(p: RatingPriorSet): void {
  if (!ALLOWED_PRIOR_BASES.has(p.basis)) {
    throw new Error(`prior basis is not an allowed provenance: ${JSON.stringify(p.basis)}`);
  }
  if (parseFx(p.n_basis) <= 0n) {
    throw new Error(`prior n_basis must be positive, got ${JSON.stringify(p.n_basis)}`);
  }
  const inUnit = (label: string, s: string): void => {
    const v = parseFx(s);
    if (v < 0n || v > ONE) throw new Error(`prior ${label} must be in [0,1], got ${JSON.stringify(s)}`);
  };
  inUnit("global", p.global);
  for (const [k, v] of Object.entries(p.by_dimension)) inUnit(`by_dimension[${k}]`, v);
}

function coverageTier(
  neffFx: bigint,
  spanDays: number,
  distinctObservers: number,
  suppressed: boolean,
  c: RatingConstantsFx,
): RatingCoverageTier {
  if (suppressed) return "none";
  if (neffFx < c.thinNeffMax) return "thin";
  if (neffFx < c.moderateNeffMax) return "moderate";
  if (intFx(spanDays) >= c.strongMinSpanDays && intFx(distinctObservers) >= c.strongMinObservers) {
    return "strong";
  }
  return "moderate";
}

type DimensionOutcome = {
  spec: DimensionSpec;
  weightFx: bigint;
  published: boolean;
  meanFx: bigint;
  halfFx: bigint;
  canonical: CanonicalValue;
};

/**
 * The self-reported cap. Given the self-reported effective weight S and the
 * everything-else effective weight O, the largest S' satisfying
 * S'/(S'+O) <= cap is cap*O/(1-cap). Contributions are scaled by S'/S rather
 * than dropped, so the ordering among self-reported claims survives and only
 * their collective influence is bounded.
 *
 * Two boundary cases, both intended. cap = 1 disables the cap. O = 0 with any
 * cap below 1 forces S' = 0: with no independent evidence at all there is no
 * share a self-report can hold without being the whole score, so a subject
 * that has only ever described itself gets no dimension score rather than a
 * flattering one.
 */
function selfReportedScaleFx(selfSumFx: bigint, otherSumFx: bigint, capFx: bigint): bigint | null {
  if (capFx >= ONE) return null;
  if (selfSumFx === 0n) return null;
  const maxSelfFx = capFx === 0n ? 0n : divFx(mulFx(capFx, otherSumFx), ONE - capFx);
  if (selfSumFx <= maxSelfFx) return null;
  return maxSelfFx === 0n ? 0n : divFx(maxSelfFx, selfSumFx);
}

function scoreDimension(
  spec: DimensionSpec,
  entries: readonly Observation[],
  priorFx: bigint,
  c: RatingConstantsFx,
  asOfSec: number,
  weightByObserver: ReadonlyMap<string, bigint>,
): DimensionOutcome {
  const accepted = new Set(spec.accepted_provenance);
  const capFx = clampFx(parseFx(spec.self_reported_cap), 0n, ONE);

  type Staged = { obs: WeightedObservation; isSelf: boolean };
  const staged: Staged[] = [];
  let rejected = 0;
  let selfSumFx = 0n;
  let otherSumFx = 0n;
  const observerIds = new Set<string>();
  let minSec = 0;
  let maxSec = 0;
  let haveAny = false;

  for (const e of entries) {
    if (!accepted.has(e.provenance)) {
      rejected += 1;
      continue;
    }
    const valueFx = clampFx(parseFx(e.value), 0n, ONE);
    const observerWeightFx = weightByObserver.get(e.observer_id);
    if (observerWeightFx === undefined) {
      throw new Error(`no weight computed for observer ${e.observer_id}`);
    }
    const entrySec = parseIsoUtcSeconds(e.ts);
    const ageSeconds = asOfSec >= entrySec ? asOfSec - entrySec : 0;
    const ageDaysFx = divRoundHalfUp(BigInt(ageSeconds) * ONE, 86400n);
    const decayFx = pow2NegFx(divFx(ageDaysFx, c.decayHalfLifeDays));
    const provFx = c.provenanceMultiplier.get(e.provenance)!;
    const effectiveWeightFx = mulFx(mulFx(observerWeightFx, decayFx), provFx);
    const isSelf = e.provenance === "self_reported";
    if (isSelf) selfSumFx += effectiveWeightFx;
    else otherSumFx += effectiveWeightFx;
    staged.push({ obs: { address: e.observer_id, effectiveWeightFx, valueFx }, isSelf });
    observerIds.add(e.observer_id);
    if (!haveAny || entrySec < minSec) minSec = entrySec;
    if (!haveAny || entrySec > maxSec) maxSec = entrySec;
    haveAny = true;
  }

  const scaleFx = selfReportedScaleFx(selfSumFx, otherSumFx, capFx);
  if (scaleFx !== null) {
    for (const s of staged) {
      if (s.isSelf) s.obs.effectiveWeightFx = mulFx(s.obs.effectiveWeightFx, scaleFx);
    }
  }
  const cappedSelfFx = scaleFx === null ? selfSumFx : mulFx(selfSumFx, scaleFx);
  const preCapTotalFx = cappedSelfFx + otherSumFx;
  const selfShareFx = preCapTotalFx === 0n ? 0n : divFx(cappedSelfFx, preCapTotalFx);

  // The per-observer ceiling is the observer's own undecayed weight. An
  // observer's provenance multiplier is already inside each contribution, so
  // the ceiling is the same for every dimension and an observer never gains
  // headroom by producing more observations.
  const sums = capAndSum(
    staged.map((s) => s.obs),
    weightByObserver,
  );
  const post = posterior(sums, priorFx, c.shrinkageK);
  const spanDays = haveAny ? floorDaysBetween(maxSec, minSec) : 0;

  let suppressionReason: string | null = null;
  if (staged.length === 0) suppressionReason = RATING_SUPPRESSION.no_usable_observations;
  else if (sums.neffFx < c.suppressionNeffFloor) suppressionReason = RATING_SUPPRESSION.neff_below_floor;
  const published = suppressionReason === null;

  return {
    spec,
    weightFx: parseFx(spec.weight),
    published,
    meanFx: post.meanFx,
    halfFx: post.widthFx / 2n,
    canonical: {
      dimension: spec.id,
      score: published ? displayScore(post.meanFx) : null,
      score_low: published ? displayScore(post.lowFx) : null,
      score_high: published ? displayScore(post.highFx) : null,
      confidence: displayAt(post.confidenceFx, PRECISION.confidence),
      n_eff: displayAt(sums.neffFx, PRECISION.n_eff),
      coverage_tier: coverageTier(sums.neffFx, spanDays, observerIds.size, !published, c),
      observation_count: staged.length,
      rejected_provenance_count: rejected,
      self_reported_share: displayAt(selfShareFx, PRECISION.signal),
      self_reported_capped: scaleFx !== null,
      distinct_observers: observerIds.size,
      span_days: spanDays,
      suppression_reason: suppressionReason,
    },
  };
}

function classify(subject: Subject, asOfSec: number, c: RatingConstantsFx): RatingLifecycle {
  const base: RatingLifecycle = subject.reachable ? "reachable" : "declared";
  if (subject.last_active_ts === null) return base;
  const lastSec = parseIsoUtcSeconds(subject.last_active_ts);
  const gapSeconds = asOfSec > lastSec ? asOfSec - lastSec : 0;
  const gapDaysFx = divRoundHalfUp(BigInt(gapSeconds) * ONE, 86400n);
  if (gapDaysFx <= c.liveWindowDays) return "live";
  if (gapDaysFx >= c.dormantWindowDays) return "dormant";
  return base;
}

/**
 * A conservative observer for an id that appears in observations but has no
 * entry in `observers`. Matches the chain path's synthesized reviewer: age 0
 * so the age multiplier sits at its floor, maximum concentration, no
 * interaction. Counted and surfaced as a signal rather than thrown, because a
 * missing aggregate row is an ordinary cadence mismatch between a collector's
 * observation write and its observer refresh.
 */
function synthesizeObserver(observerId: string, asOfTs: string): Observer {
  return {
    observer_id: observerId,
    observer_kind: "reviewer",
    first_seen_ts: asOfTs,
    total_observations: 1,
    distinct_subjects: 1,
    max_observations_single_day: 1,
    independence_group: null,
    concentration: "1.000000",
    has_interaction_with_subject: false,
  };
}

export function scoreSubject(subject: Subject): { result: SubjectScoreResult; canonicalBytes: string } {
  const profile = getRatingProfile(subject.profile_id);
  if (profile.kind !== subject.kind) {
    throw new Error(
      `profile ${profile.profile_id} rates ${JSON.stringify(profile.kind)}, subject is ${JSON.stringify(subject.kind)}`,
    );
  }
  const c = parseRatingConstants(subject.constants);
  const asOfSec = parseIsoUtcSeconds(subject.as_of_ts);
  assertValidPrior(subject.priors);

  // Dedupe by the observation primary key before anything counts it. A
  // duplicated row must not contribute twice, and the hash dedupes on the same
  // key so a replayed collector run reproduces the same inputs_hash.
  const seen = new Set<string>();
  const deduped: Observation[] = [];
  for (const o of [...subject.observations].sort((a, b) => {
    const ka = observationKey(a);
    const kb = observationKey(b);
    return ka < kb ? -1 : ka > kb ? 1 : 0;
  })) {
    const k = observationKey(o);
    if (seen.has(k)) continue;
    seen.add(k);
    deduped.push(o);
  }

  const knownDimensions = new Set(profile.dimensions.map((d) => d.id));
  const usable: Observation[] = [];
  let unknownDimensionCount = 0;
  for (const o of deduped) {
    if (knownDimensions.has(o.dimension)) usable.push(o);
    else unknownDimensionCount += 1;
  }

  const observerIds = [...new Set(usable.map((o) => o.observer_id))].sort();
  let synthesizedObserverCount = 0;
  const observers: Observer[] = observerIds.map((id) => {
    // Own-key check, not a bracket read: an observer_id equal to an inherited
    // member ("__proto__") must take the synthesize path, not return the
    // prototype object.
    if (Object.hasOwn(subject.observers, id)) return subject.observers[id]!;
    synthesizedObserverCount += 1;
    return synthesizeObserver(id, subject.as_of_ts);
  });
  const observerWeights: ObserverWeightFx[] = computeObserverWeights(observers, asOfSec, c);
  const weightByObserver = new Map(observerWeights.map((w) => [w.observerId, w.weightFx]));

  const priorGlobalFx = parseFx(subject.priors.global);
  const outcomes: DimensionOutcome[] = profile.dimensions.map((spec) => {
    const entries = usable.filter((o) => o.dimension === spec.id);
    const priorStr = Object.hasOwn(subject.priors.by_dimension, spec.id)
      ? subject.priors.by_dimension[spec.id]!
      : subject.priors.global;
    return scoreDimension(spec, entries, parseFx(priorStr), c, asOfSec, weightByObserver);
  });

  // Composite. The interval assumes the published dimensions are perfectly
  // correlated, so its width is the weighted mean of the dimension widths.
  // Assuming independence instead would give a narrower band by combining
  // variances, and there is no evidence that availability and conformance (say)
  // fail independently. The conservative assumption is the honest one until a
  // calibration run measures the correlation.
  let totalWeightFx = 0n;
  let publishedWeightFx = 0n;
  let weightedMeanFx = 0n;
  let weightedHalfFx = 0n;
  for (const o of outcomes) {
    totalWeightFx += o.weightFx;
    if (!o.published) continue;
    publishedWeightFx += o.weightFx;
    weightedMeanFx += mulFx(o.weightFx, o.meanFx);
    weightedHalfFx += mulFx(o.weightFx, o.halfFx);
  }
  if (totalWeightFx <= 0n) throw new Error(`profile ${profile.profile_id} has no dimension weight`);
  const coverageFx = divFx(publishedWeightFx, totalWeightFx);
  const minCoverageFx = clampFx(parseFx(profile.min_dimension_coverage), 0n, ONE);

  let compositeReason: string | null = null;
  if (publishedWeightFx === 0n) compositeReason = RATING_SUPPRESSION.no_usable_observations;
  else if (coverageFx < minCoverageFx) compositeReason = RATING_SUPPRESSION.dimension_coverage_short;

  let compositeMeanFx = 0n;
  let compositeHalfFx = 0n;
  let compositeConfidenceFx = 0n;
  if (publishedWeightFx > 0n) {
    compositeMeanFx = divFx(weightedMeanFx, publishedWeightFx);
    compositeHalfFx = divFx(weightedHalfFx, publishedWeightFx);
    const refFx = referenceWidthFx(c.shrinkageK);
    compositeConfidenceFx = refFx === 0n ? 0n : ONE - minFx(ONE, divFx(2n * compositeHalfFx, refFx));
  }
  const publish = compositeReason === null;

  // Signals: observable conditions only, never intent (SPEC 5.5).
  const groups = new Map<string, number>();
  for (const o of observers) {
    if (o.independence_group === null) continue;
    groups.set(o.independence_group, (groups.get(o.independence_group) ?? 0) + 1);
  }
  let largestGroup = 0;
  for (const n of groups.values()) if (n > largestGroup) largestGroup = n;
  const largestGroupShareFx =
    observers.length === 0 ? 0n : divRoundHalfUp(BigInt(largestGroup) * ONE, BigInt(observers.length));
  const ungrouped = observers.filter((o) => o.independence_group === null).length;
  const byProvenance = new Map<string, number>();
  for (const o of usable) byProvenance.set(o.provenance, (byProvenance.get(o.provenance) ?? 0) + 1);

  const signals: Record<string, CanonicalValue> = {
    distinct_observers: observers.length,
    largest_independence_group_share: displayAt(largestGroupShareFx, PRECISION.signal),
    ungrouped_observer_count: ungrouped,
    synthesized_observer_count: synthesizedObserverCount,
    unknown_dimension_observations: unknownDimensionCount,
    measured_observations: byProvenance.get("measured") ?? 0,
    attested_observations: byProvenance.get("attested") ?? 0,
    third_party_review_observations: byProvenance.get("third_party_review") ?? 0,
    self_reported_observations: byProvenance.get("self_reported") ?? 0,
    published_dimensions: outcomes.filter((o) => o.published).length,
    profile_dimensions: outcomes.length,
  };

  const tree: CanonicalValue = {
    rating_methodology_version: subject.constants.rating_methodology_version,
    profile_id: profile.profile_id,
    kind: subject.kind,
    subject_id: subject.subject_id,
    computed_at: subject.as_of_ts,

    composite: publish ? displayScore(compositeMeanFx) : null,
    composite_low: publish ? displayScore(clampFx(compositeMeanFx - compositeHalfFx, 0n, ONE)) : null,
    composite_high: publish ? displayScore(clampFx(compositeMeanFx + compositeHalfFx, 0n, ONE)) : null,
    composite_confidence: displayAt(compositeConfidenceFx, PRECISION.confidence),
    dimension_coverage: displayAt(coverageFx, PRECISION.signal),
    composite_suppression_reason: compositeReason,

    lifecycle: classify(subject, asOfSec, c),
    dimensions: outcomes.map((o) => o.canonical),
    observer_weights: observerWeights.map((w) => ({
      observer_id: w.observerId,
      weight: displayAt(w.weightFx, PRECISION.weight),
    })),
    signals,
    inputs_hash: subjectInputsHash(subject),
  };

  const canonicalBytes = canonicalJson(tree);
  const result = JSON.parse(canonicalBytes) as SubjectScoreResult;
  return { result, canonicalBytes };
}

export { subjectInputsCanonical, subjectInputsHash } from "./hash.js";
export { computeObserverWeights } from "./weights.js";
export { parseRatingConstants } from "./constants.js";
export type { RatingConstantsFx } from "./constants.js";
