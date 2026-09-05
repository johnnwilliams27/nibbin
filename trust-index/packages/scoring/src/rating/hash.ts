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
import type {
  CanonicalValue,
  Observation,
  Observer,
  RatingConstants,
  RatingProfile,
  Subject,
} from "@trust-index/types";
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

/**
 * Primary key of an observation. Matches the scorer's dedupe key exactly.
 *
 * The timestamp is part of the identity, and that is the whole point.
 * `observation_key` names the CHECK ("handshake", "credential_parameter_present"),
 * because a gate has to be able to match it and a reader has to be able to
 * read it. Identity is that check at a moment. Two rows from one observer with
 * the same check at the same instant are a duplicated row and collapse; the
 * same check run again tomorrow is a second measurement and must not.
 *
 * Getting this wrong the other way is easy and quiet. Making the key alone the
 * identity forces a collector with a run history to namespace its keys per
 * run, which preserves the samples and silently breaks every gate that matches
 * on a key. Found exactly that way.
 */
/**
 * The check an observation is an instance of.
 *
 * Observation keys carry an instance suffix after a colon — `availability:1`
 * for the first probe attempt, `invocation_succeeds:search_docs` for one tool
 * of many on a server. Identity needs the suffix, or a server's twenty tools
 * would dedupe down to one observation and the nineteen that failed would
 * vanish. Gate matching needs the base, or a gate written against
 * `credential_parameter_present` would never fire once the collector started
 * distinguishing which tool it found it on.
 */
export function observationCheck(observationKey: string): string {
  const i = observationKey.indexOf(":");
  return i === -1 ? observationKey : observationKey.slice(0, i);
}

export function observationKey(o: Observation): string {
  return `${o.observer_id}#${o.dimension}#${o.observation_key}#${o.ts}`;
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
      judged: d(c.provenance_multiplier.judged),
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

/**
 * The profile's canonical form. Hashed into the result as `profile_digest`.
 *
 * The rubric lives in code, not in the Subject, so inputs_hash alone cannot
 * tell a reader which rules produced a score: a changed weight, a new gate, or
 * a retuned per-dimension decay would move every score in the compendium while
 * every inputs_hash stayed put. The digest closes that. Two results carrying
 * the same inputs_hash AND the same profile_digest were produced from the same
 * evidence under the same rules, which is the only version of the
 * reproducibility claim worth publishing.
 *
 * Labels, rubric prose and summaries are excluded: they are how the rules are
 * explained, not what they are, and fixing a typo in a rubric must not
 * invalidate every score computed under it.
 */
export function profileCanonical(p: RatingProfile): string {
  const d = canonicalDecimal;
  const tree: CanonicalValue = {
    profile_id: p.profile_id,
    kind: p.kind,
    min_dimension_coverage: d(p.min_dimension_coverage),
    // Omitted until it was pointed out. It decides 259 of 600 outcomes in the
    // current population — the dominant withholding reason — so a profile
    // could change what it publishes with every digest unmoved, which makes
    // the reproducibility claim above false rather than incomplete.
    min_assessment_completeness: d(p.min_assessment_completeness),
    constants: p.constants === undefined ? null : constantOverrides(p.constants),
    dimensions: [...p.dimensions]
      .sort((a, b) => cmp(a.id, b.id))
      .map((dim) => ({
        id: dim.id,
        weight: d(dim.weight),
        self_reported_cap: d(dim.self_reported_cap),
        accepted_provenance: [...dim.accepted_provenance].sort(),
        constants: dim.constants === undefined ? null : constantOverrides(dim.constants),
      })),
    gates: [...p.gates]
      .sort((a, b) => cmp(a.id, b.id))
      .map((g) => ({
        id: g.id,
        dimension: g.dimension,
        trigger: g.trigger,
        observation_key: g.observation_key,
        at_or_below: d(g.at_or_below),
        trigger_provenance: [...g.trigger_provenance].sort(),
        caps_composite_at: d(g.caps_composite_at),
        caps_dimension_at: g.caps_dimension_at === null ? null : d(g.caps_dimension_at),
      })),
  };
  return canonicalJson(tree);
}

function constantOverrides(o: Partial<Record<string, string>>): CanonicalValue {
  return Object.fromEntries(
    Object.keys(o)
      .sort()
      .map((k) => [k, canonicalDecimal(o[k]!)]),
  );
}

export function profileDigest(p: RatingProfile): string {
  return createHash("sha256").update(profileCanonical(p), "utf8").digest("hex");
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
    // tags are deliberately absent: they never enter the score, and a hash
    // that moved when a label was applied would break agreement between two
    // reproducers of identical evidence. `cohort` IS present, because it names
    // the population a prior was drawn from, and that prior does enter.
    priors: {
      global: canonicalDecimal(s.priors.global),
      by_dimension: Object.fromEntries(
        Object.keys(s.priors.by_dimension)
          .sort()
          .map((k) => [k, canonicalDecimal(s.priors.by_dimension[k]!)]),
      ),
      basis: s.priors.basis,
      n_basis: canonicalDecimal(s.priors.n_basis),
      cohort: s.priors.cohort,
    },
    constants: constantsCanonical(s.constants),
  };
  return canonicalJson(tree);
}

export function subjectInputsHash(s: Subject): string {
  return createHash("sha256").update(subjectInputsCanonical(s), "utf8").digest("hex");
}
