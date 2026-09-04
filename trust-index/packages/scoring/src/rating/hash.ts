/**
 * inputs_hash for the generic path: sha256 of the canonical JSON of a
 * Subject's scoring-relevant fields (SPEC 22, same contract as hash.ts).
 *
 * Included: identity and frame, the profile id (a different rubric is a
 * different score), reachability and lifecycle inputs, every observation and
 * observer, the priors, and every constant value.
 *
 * Excluded: subject_version (shape, not input) and evidence_ref (an audit
 * pointer that does not enter the estimator; two reproducers citing the same
 * evidence by different URLs must agree).
 *
 * Arrays are sorted into a canonical order and observations deduplicated by
 * their primary key before hashing, exactly as the scorer does, so two honest
 * reproducers of the same evidence compute the same root.
 */
import { createHash } from "node:crypto";
import type { CanonicalValue, Observation, Observer, RatingConstants, Subject } from "@trust-index/types";
import { canonicalJson } from "@trust-index/types";

function canonicalDecimal(s: string): string {
  if (!/^-?\d+(\.\d+)?$/.test(s)) {
    throw new SyntaxError(`not a decimal string: ${JSON.stringify(s)}`);
  }
  const neg = s.startsWith("-");
  const body = neg ? s.slice(1) : s;
  const dot = body.indexOf(".");
  const intPart = (dot === -1 ? body : body.slice(0, dot)).replace(/^0+(?=\d)/, "");
  const fracPart = (dot === -1 ? "" : body.slice(dot + 1)).replace(/0+$/, "");
  const out = fracPart.length > 0 ? `${intPart}.${fracPart}` : intPart;
  return out === "0" || out === "" ? "0" : neg ? `-${out}` : out;
}

function cmp(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Primary key of an observation. Matches the scorer's dedupe key exactly. */
export function observationKey(o: Observation): string {
  return `${o.observer_id}#${o.dimension}#${o.observation_key}`;
}

function observationCanonical(o: Observation): CanonicalValue {
  return {
    observer_id: o.observer_id,
    dimension: o.dimension,
    provenance: o.provenance,
    value: canonicalDecimal(o.value),
    ts: o.ts,
    observation_key: o.observation_key,
  };
}

function observerCanonical(o: Observer): CanonicalValue {
  return {
    observer_id: o.observer_id,
    observer_kind: o.observer_kind,
    first_seen_ts: o.first_seen_ts,
    total_observations: o.total_observations,
    distinct_subjects: o.distinct_subjects,
    max_observations_single_day: o.max_observations_single_day,
    independence_group: o.independence_group,
    concentration: canonicalDecimal(o.concentration),
    has_interaction_with_subject: o.has_interaction_with_subject,
  };
}

function constantsCanonical(c: RatingConstants): CanonicalValue {
  const d = canonicalDecimal;
  return {
    rating_methodology_version: c.rating_methodology_version,
    shrinkage_k: d(c.shrinkage_k),
    decay_half_life_days: d(c.decay_half_life_days),
    age_ramp_days: d(c.age_ramp_days),
    age_floor: d(c.age_floor),
    group_penalty: d(c.group_penalty),
    concentration_penalty: d(c.concentration_penalty),
    velocity_threshold_per_day: d(c.velocity_threshold_per_day),
    velocity_multiplier: d(c.velocity_multiplier),
    interaction_multiplier: d(c.interaction_multiplier),
    provenance_multiplier: {
      measured: d(c.provenance_multiplier.measured),
      attested: d(c.provenance_multiplier.attested),
      third_party_review: d(c.provenance_multiplier.third_party_review),
      self_reported: d(c.provenance_multiplier.self_reported),
    },
    weight_floor: d(c.weight_floor),
    suppression_neff_floor: d(c.suppression_neff_floor),
    live_window_days: d(c.live_window_days),
    dormant_window_days: d(c.dormant_window_days),
    thin_neff_max: d(c.thin_neff_max),
    moderate_neff_max: d(c.moderate_neff_max),
    strong_min_span_days: d(c.strong_min_span_days),
    strong_min_observers: d(c.strong_min_observers),
  };
}

export function subjectInputsCanonical(s: Subject): string {
  const seen = new Set<string>();
  const observations: CanonicalValue[] = [];
  for (const o of [...s.observations].sort((a, b) => cmp(observationKey(a), observationKey(b)))) {
    const k = observationKey(o);
    if (seen.has(k)) continue;
    seen.add(k);
    observations.push(observationCanonical(o));
  }
  const tree: CanonicalValue = {
    kind: s.kind,
    subject_id: s.subject_id,
    source: { registry: s.source.registry, ref: s.source.ref, url: s.source.url },
    profile_id: s.profile_id,
    as_of_ts: s.as_of_ts,
    first_seen_ts: s.first_seen_ts,
    last_active_ts: s.last_active_ts,
    reachable: s.reachable,
    observations,
    observers: Object.fromEntries(
      Object.keys(s.observers)
        .sort()
        .map((id) => [id, observerCanonical(s.observers[id]!)]),
    ),
    priors: {
      global: canonicalDecimal(s.priors.global),
      by_dimension: Object.fromEntries(
        Object.keys(s.priors.by_dimension)
          .sort()
          .map((k) => [k, canonicalDecimal(s.priors.by_dimension[k]!)]),
      ),
      basis: s.priors.basis,
      n_basis: canonicalDecimal(s.priors.n_basis),
    },
    constants: constantsCanonical(s.constants),
  };
  return canonicalJson(tree);
}

export function subjectInputsHash(s: Subject): string {
  return createHash("sha256").update(subjectInputsCanonical(s), "utf8").digest("hex");
}
