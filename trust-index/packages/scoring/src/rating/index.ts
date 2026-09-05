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
 *   5. Apply the volume cap (capAndSum) so one observer cannot outvote the
 *      rest by volume. See VOLUME CAP below for what "one" means.
 *   6. Shrink toward the prior and take the interval.
 *
 * Steps 4 and 5 are separate on purpose. The first bounds one PROVENANCE, the
 * second bounds one OBSERVER, and an attacker who controls both the subject
 * and a pile of review accounts has to get past both.
 *
 * VOLUME CAP. The chain path caps a reviewer's total contribution at one
 * review's worth, because a reviewer who repeats an opinion has not produced
 * more evidence. That rule is right for opinions and wrong for measurements.
 * Ten probes of an endpoint on ten different days are ten independent samples
 * of whether it answers; ten probes in the same minute are one. So:
 *
 *   third_party_review, self_reported   capped per observer
 *   measured, attested                  capped per observer PER UTC DAY
 *
 * The day bucket is the smallest unit that is both defensible and unforgeable
 * from outside. A probe cannot manufacture confidence by looping, because
 * every extra call inside a day collapses into the same bucket, and it cannot
 * manufacture days. Without this rule a measured dimension could never reach
 * an n_eff above one observer's weight, every MCP server in existence would
 * shrink to within a few points of the prior, and the ratings would be a
 * restatement of the prior wearing a subject's name.
 */
import type {
  CanonicalValue,
  DimensionSpec,
  Observation,
  Observer,
  RatingCoverageTier,
  RatingLifecycle,
  RatingPriorSet,
  RatingProfile,
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
import { parseRatingConstants, resolveDimensionConstants, type RatingConstantsFx } from "./constants.js";
import { profileDigest, subjectInputsHash, observationKey, observationCheck } from "./hash.js";
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
  lowFx: bigint;
  highFx: bigint;
  halfFx: bigint;
  confidenceFx: bigint;
  neffFx: bigint;
  spanDays: number;
  distinctObservers: number;
  observationCount: number;
  rejectedCount: number;
  selfShareFx: bigint;
  selfCapped: boolean;
  suppressionReason: string | null;
  /** Observations that passed the provenance filter, kept for gate evaluation. */
  admissible: readonly Observation[];
  /** The dimension's own resolved constants, needed to render its coverage tier. */
  tierConstants: RatingConstantsFx;
  /** Ceiling imposed by a gate, or null. Filled in after gates run. */
  gateCapFx: bigint | null;
  gateCappedBy: string | null;
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
  // Cap keys, one per bucket, each mapped back to the owning observer's
  // undecayed weight so capAndSum bounds a bucket at that observer's worth.
  const capWeights = new Map<string, bigint>();
  const admissible: Observation[] = [];
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
    // A measurement is bucketed by the UTC day it was taken; an opinion is
    // not bucketed at all. The key is length-prefixed so it is injective:
    // an observer id containing the separator cannot be made to collide
    // with another observer's bucket.
    // A judgement is bucketed with measurements for the volume cap: judging
    // the same stored transcript again on a later day is a second independent
    // reading, and two readings that disagree should widen the interval rather
    // than one silently replacing the other.
    const measured = e.provenance === "measured" || e.provenance === "attested" || e.provenance === "judged";
    const capKey = measured
      ? `${e.observer_id.length}:${e.observer_id}|${Math.floor(entrySec / 86400)}`
      : `${e.observer_id.length}:${e.observer_id}|*`;
    capWeights.set(capKey, observerWeightFx);
    staged.push({ obs: { address: capKey, effectiveWeightFx, valueFx }, isSelf });
    admissible.push(e);
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

  // Each bucket's ceiling is the owning observer's undecayed weight, so one
  // day of measurement is worth at most one observer's voice however many
  // calls it took. The provenance multiplier is already inside each
  // contribution, so no bucket gains headroom by producing more observations.
  const sums = capAndSum(
    staged.map((s) => s.obs),
    capWeights,
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
    lowFx: post.lowFx,
    highFx: post.highFx,
    halfFx: post.widthFx / 2n,
    confidenceFx: post.confidenceFx,
    neffFx: sums.neffFx,
    spanDays,
    distinctObservers: observerIds.size,
    observationCount: staged.length,
    rejectedCount: rejected,
    selfShareFx,
    selfCapped: scaleFx !== null,
    suppressionReason,
    admissible,
    tierConstants: c,
    gateCapFx: null,
    gateCappedBy: null,
  };
}

/**
 * Run the profile's gates against the dimension outcomes.
 *
 * Gates fire independently and the strictest ceiling wins, because a subject
 * with two findings is not less capped than a subject with one. A gate on a
 * dimension that produced no admissible evidence cannot fire: absence of
 * evidence is not a finding, and a gate that fired on silence would punish
 * every subject nobody has probed yet.
 */
function applyGates(
  profile: RatingProfile,
  outcomes: DimensionOutcome[],
): { fired: CanonicalValue[]; compositeCapFx: bigint | null } {
  const byId = new Map(outcomes.map((o) => [o.spec.id, o]));
  const fired: Array<{ id: string; canonical: CanonicalValue }> = [];
  let compositeCapFx: bigint | null = null;

  for (const gate of profile.gates) {
    const outcome = byId.get(gate.dimension);
    if (outcome === undefined) continue;
    const thresholdFx = clampFx(parseFx(gate.at_or_below), 0n, ONE);
    const allowed = new Set<string>(gate.trigger_provenance);
    let observedFx: bigint | null = null;
    let triggerLabel = "";

    if (gate.trigger === "observation") {
      // A keyless observation gate would fire on any low ratio, and a ratio is
      // an average, which is the thing gates exist to escape. Refuse it rather
      // than guess.
      if (gate.observation_key === null) {
        throw new Error(`gate ${gate.id} is an observation gate with no observation_key`);
      }
      for (const o of outcome.admissible) {
        // Base check, not the whole key: see observationCheck.
        if (observationCheck(o.observation_key) !== gate.observation_key) continue;
        // Provenance is checked again here, not inherited from the dimension.
        // A dimension may accept reviews while its gate does not, and that gap
        // is what stops anyone capping a rival by posting an opinion.
        if (!allowed.has(o.provenance)) continue;
        const v = clampFx(parseFx(o.value), 0n, ONE);
        if (v > thresholdFx) continue;
        if (observedFx === null || v < observedFx) observedFx = v;
      }
      triggerLabel = gate.observation_key;
    } else {
      // An estimate gate needs an estimate. A suppressed dimension has none.
      if (!outcome.published) continue;
      if (!outcome.admissible.some((o) => allowed.has(o.provenance))) continue;
      if (outcome.highFx <= thresholdFx) {
        observedFx = outcome.highFx;
        triggerLabel = "score_high";
      }
    }
    if (observedFx === null) continue;

    const capFx = clampFx(parseFx(gate.caps_composite_at), 0n, ONE);
    if (compositeCapFx === null || capFx < compositeCapFx) compositeCapFx = capFx;
    if (gate.caps_dimension_at !== null) {
      const dimCapFx = clampFx(parseFx(gate.caps_dimension_at), 0n, ONE);
      if (outcome.gateCapFx === null || dimCapFx < outcome.gateCapFx) {
        outcome.gateCapFx = dimCapFx;
        outcome.gateCappedBy = gate.id;
      }
    }
    fired.push({
      id: gate.id,
      canonical: {
        gate_id: gate.id,
        dimension: gate.dimension,
        trigger: triggerLabel,
        observed: displayScore(observedFx),
        caps_composite_at: displayScore(capFx),
        reason: gate.reason,
      },
    });
  }

  fired.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return { fired: fired.map((f) => f.canonical), compositeCapFx };
}

/**
 * Render one dimension after gates have been applied. Capping moves the point
 * estimate and the upper bound down to the ceiling and leaves the lower bound
 * alone: a gate says "no better than this", never "exactly this", and widening
 * the interval downward would claim knowledge the gate does not carry.
 */
function dimensionCanonical(o: DimensionOutcome): CanonicalValue {
  const capFx = o.gateCapFx;
  const capped = capFx !== null;
  const meanFx = capped && o.meanFx > capFx ? capFx : o.meanFx;
  const highFx = capped && o.highFx > capFx ? capFx : o.highFx;
  const lowFx = o.lowFx > meanFx ? meanFx : o.lowFx;
  return {
    dimension: o.spec.id,
    score: o.published ? displayScore(meanFx) : null,
    score_low: o.published ? displayScore(lowFx) : null,
    score_high: o.published ? displayScore(highFx) : null,
    confidence: displayAt(o.confidenceFx, PRECISION.confidence),
    n_eff: displayAt(o.neffFx, PRECISION.n_eff),
    coverage_tier: coverageTier(o.neffFx, o.spanDays, o.distinctObservers, !o.published, o.tierConstants),
    observation_count: o.observationCount,
    rejected_provenance_count: o.rejectedCount,
    self_reported_share: displayAt(o.selfShareFx, PRECISION.signal),
    self_reported_capped: o.selfCapped,
    distinct_observers: o.distinctObservers,
    span_days: o.spanDays,
    suppression_reason: o.suppressionReason,
    gate_capped_by: o.gateCappedBy,
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
    // Constants are resolved per dimension: the subject's, overlaid by the
    // profile's, overlaid by the dimension's. Availability decays in two
    // weeks and maintenance in a year, and one global half-life could not
    // serve both.
    const dc = resolveDimensionConstants(c, profile, spec);
    return scoreDimension(spec, entries, parseFx(priorStr), dc, asOfSec, weightByObserver);
  });

  // Gates run before the composite is formed, so a capped dimension enters the
  // roll-up already capped rather than being averaged at full value and
  // trimmed afterwards.
  const { fired: gatesFired, compositeCapFx } = applyGates(profile, outcomes);

  // Assessment completeness. A dimension is unassessable when a harness gap
  // blocked it and no observation reached it anyway: we could not attempt it,
  // so its absence says nothing about the subject.
  //
  // The rule this enforces has no exception. A gap is never evidence. If our
  // testnet wallet runs dry, the subject does not lose points for it; the
  // dimension drops out of the completeness denominator and the gap is
  // reported as ours to fix. Reading a failure to obtain data as a fact about
  // the data is the error that has cost this project the most, and this is the
  // one place it could be published under someone else's name.
  const blockedDimensions = new Set<string>();
  for (const g of subject.gaps) {
    if (g.cause !== "harness_capability_missing" && g.cause !== "harness_capability_unhealthy") continue;
    blockedDimensions.add(g.dimension);
  }
  let assessableWeightFx = 0n;
  for (const o of outcomes) {
    // Blocked only counts when nothing got through: a dimension with a
    // published score was clearly assessable, whatever else was missing.
    if (blockedDimensions.has(o.spec.id) && !o.published) continue;
    assessableWeightFx += o.weightFx;
  }

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
    const cappedMeanFx = o.gateCapFx !== null && o.meanFx > o.gateCapFx ? o.gateCapFx : o.meanFx;
    weightedMeanFx += mulFx(o.weightFx, cappedMeanFx);
    weightedHalfFx += mulFx(o.weightFx, o.halfFx);
  }
  if (totalWeightFx <= 0n) throw new Error(`profile ${profile.profile_id} has no dimension weight`);
  const completenessFx = divFx(assessableWeightFx, totalWeightFx);
  // Coverage is measured against what was ASSESSABLE, not against the whole
  // profile. Otherwise one missing credential would silently push thousands of
  // subjects under the coverage floor and withhold their ratings as though
  // they had failed to provide evidence, when in fact we failed to ask.
  const coverageFx = assessableWeightFx === 0n ? 0n : divFx(publishedWeightFx, assessableWeightFx);
  const minCoverageFx = clampFx(parseFx(profile.min_dimension_coverage), 0n, ONE);

  const minCompletenessFx = clampFx(parseFx(profile.min_assessment_completeness), 0n, ONE);

  let compositeReason: string | null = null;
  if (publishedWeightFx === 0n) compositeReason = RATING_SUPPRESSION.no_usable_observations;
  // Completeness is checked BEFORE coverage, because the two floors otherwise
  // combine into a hole. A server behind an HTTP 401 answers, so availability
  // is measurable and everything else is a harness gap; coverage over the
  // assessable share is then a perfect 1.0 and a server we could not test
  // publishes a high composite from one dimension. Assessing a quarter of a
  // profile and liking what you see is not a rating.
  else if (completenessFx < minCompletenessFx) compositeReason = RATING_SUPPRESSION.assessment_incomplete;
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
  // The composite ceiling. Confidence is deliberately NOT recomputed from the
  // capped interval: a gate does not make us more certain about the subject,
  // it makes the number we publish a bound rather than an estimate, and
  // reporting a narrower band as higher confidence would invert that.
  const compositeCapped = compositeCapFx !== null && compositeMeanFx > compositeCapFx;
  if (compositeCapped) compositeMeanFx = compositeCapFx!;
  const compositeHighFx = clampFx(
    compositeCapped ? minFx(compositeCapFx!, compositeMeanFx + compositeHalfFx) : compositeMeanFx + compositeHalfFx,
    0n,
    ONE,
  );
  const compositeLowFx = minFx(clampFx(compositeMeanFx - compositeHalfFx, 0n, ONE), compositeMeanFx);
  if (compositeReason === null && compositeCapped) compositeReason = RATING_SUPPRESSION.gate;
  // A gate caps a published composite; it never turns a withheld one into a
  // published one, so `publish` is decided before the cap is recorded.
  const publish = publishedWeightFx > 0n && completenessFx >= minCompletenessFx && coverageFx >= minCoverageFx;

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
    judged_observations: byProvenance.get("judged") ?? 0,
    attested_observations: byProvenance.get("attested") ?? 0,
    third_party_review_observations: byProvenance.get("third_party_review") ?? 0,
    self_reported_observations: byProvenance.get("self_reported") ?? 0,
    published_dimensions: outcomes.filter((o) => o.published).length,
    profile_dimensions: outcomes.length,
    harness_blocked_checks: subject.gaps.filter(
      (g) => g.cause === "harness_capability_missing" || g.cause === "harness_capability_unhealthy",
    ).length,
    subject_blocked_checks: subject.gaps.filter((g) => g.cause === "subject_blocked").length,
    not_applicable_checks: subject.gaps.filter((g) => g.cause === "not_applicable").length,
  };

  const tree: CanonicalValue = {
    rating_methodology_version: subject.constants.rating_methodology_version,
    profile_id: profile.profile_id,
    kind: subject.kind,
    subject_id: subject.subject_id,
    computed_at: subject.as_of_ts,

    composite: publish ? displayScore(compositeMeanFx) : null,
    composite_low: publish ? displayScore(compositeLowFx) : null,
    composite_high: publish ? displayScore(compositeHighFx) : null,
    composite_confidence: displayAt(compositeConfidenceFx, PRECISION.confidence),
    dimension_coverage: displayAt(coverageFx, PRECISION.signal),
    assessment_completeness: displayAt(completenessFx, PRECISION.signal),
    composite_suppression_reason: compositeReason,

    lifecycle: classify(subject, asOfSec, c),
    dimensions: outcomes.map(dimensionCanonical),
    gates_fired: gatesFired,
    harness_gaps: [...subject.gaps]
      .filter((g) => g.cause === "harness_capability_missing" || g.cause === "harness_capability_unhealthy")
      .sort((a, b) => {
        const ka = `${a.dimension}#${a.check}`;
        const kb = `${b.dimension}#${b.check}`;
        return ka < kb ? -1 : ka > kb ? 1 : 0;
      })
      .map((g) => ({ dimension: g.dimension, check: g.check, capability: g.capability, detail: g.detail })),
    observer_weights: observerWeights.map((w) => ({
      observer_id: w.observerId,
      weight: displayAt(w.weightFx, PRECISION.weight),
    })),
    signals,
    profile_digest: profileDigest(profile),
    inputs_hash: subjectInputsHash(subject),
  };

  const canonicalBytes = canonicalJson(tree);
  const result = JSON.parse(canonicalBytes) as SubjectScoreResult;
  return { result, canonicalBytes };
}

export { subjectInputsCanonical, subjectInputsHash, profileCanonical, profileDigest } from "./hash.js";
export { computeObserverWeights } from "./weights.js";
export { parseRatingConstants, resolveDimensionConstants } from "./constants.js";
export type { RatingConstantsFx } from "./constants.js";
