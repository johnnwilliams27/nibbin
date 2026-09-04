/**
 * AgentSnapshot to Subject.
 *
 * This exists to prove the generic contract is not a parallel universe. The
 * ERC-8004 case is the one with a working scorer, a golden corpus and a
 * measured population behind it, so if the generic evidence type cannot
 * express it, the generic evidence type is wrong. It maps, and the test beside
 * this file shows the two paths agreeing to the last digit on a controlled
 * fixture.
 *
 * What maps cleanly:
 *
 *   feedback entry       -> counterparty_satisfaction, third_party_review
 *   reviewer stats       -> observer (funder cluster becomes independence_group)
 *   commerce record      -> delivery, measured
 *   metadata + wallet    -> identity_integrity, measured
 *
 * What does not, and is left absent rather than invented:
 *
 *   availability         a snapshot holds no probe result. The chain index
 *                        records whether an agent DECLARES an endpoint, which
 *                        is reachability, not availability. Emitting a
 *                        declaration as if it were a measurement is exactly
 *                        the confusion this whole layer exists to prevent, so
 *                        the dimension stays unpublished and the composite
 *                        reports the reduced coverage.
 *
 * Two chain-specific rules stay on the chain side of the boundary, where they
 * belong. Ownership epochs (SPEC 11.6) are applied here, so the Subject
 * carries exactly the evidence the chain engine would score; the generic
 * engine has no concept of an epoch and does not need one. Scale detection
 * (SPEC 11.10) is applied here too, through the engine's own normalizeValue,
 * so a feedback entry with an uninferable scale never becomes an observation
 * at all.
 */
import type {
  AgentSnapshot,
  DecimalString,
  Observation,
  Observer,
  RatingConstants,
  Subject,
} from "@trust-index/types";
import { DEFAULT_RATING_CONSTANTS, FixedNum } from "@trust-index/types";
import { inCurrentEpoch, resolveEpoch } from "../epochs.js";
import { INNER } from "../fixedmath.js";
import { normalizeValue } from "../normalize.js";
import { parseIsoUtcSeconds } from "../time.js";

/**
 * Emitted at INNER precision rather than the 6-place wire precision, so the
 * adapter is lossless: a normalized value round-trips through the Subject
 * without a rounding step the chain path does not have.
 */
function fxToDecimal(v: bigint): DecimalString {
  return new FixedNum(v, INNER).toDecimalString();
}

/**
 * Constants shared between the two paths take the snapshot's values, so a
 * comparison between them is a comparison of methodology rather than of
 * settings. The rest (provenance multipliers, the group penalty) have no
 * chain-path twin and keep their generic defaults.
 *
 * decay_half_life_days, age_ramp_days, age_floor, weight_floor,
 * suppression_neff_floor and shrinkage_k are the same constant in both, so
 * they are carried across. cohort_penalty and common_funder_multiplier are NOT
 * carried: the generic path folds both into one group_penalty and there is no
 * arithmetic that turns two multipliers into one without inventing something.
 */
export function ratingConstantsFromMethodology(s: AgentSnapshot): RatingConstants {
  const m = s.constants;
  return {
    ...DEFAULT_RATING_CONSTANTS,
    rating_methodology_version: `r0.1.0+m${m.methodology_version}`,
    shrinkage_k: m.shrinkage_k.value,
    decay_half_life_days: m.decay_half_life_days.value,
    age_ramp_days: m.weight.age_ramp_days.value,
    age_floor: m.weight.age_floor.value,
    velocity_threshold_per_day: m.weight.velocity_threshold_per_day.value,
    velocity_multiplier: m.weight.velocity_multiplier.value,
    interaction_multiplier: m.weight.commerce_multiplier.value,
    concentration_penalty: m.weight.portfolio_penalty.value,
    weight_floor: m.weight.weight_floor.value,
    suppression_neff_floor: m.suppression_neff_floor.value,
    thin_neff_max: m.tiers.thin_neff_max.value,
    moderate_neff_max: m.tiers.moderate_neff_max.value,
    strong_min_span_days: m.tiers.strong_min_span_days.value,
    strong_min_observers: m.tiers.strong_min_counterparties.value,
    live_window_days: m.lifecycle.live_window_days.value,
    dormant_window_days: m.lifecycle.dormant_window_days.value,
  };
}

export type AdapterOptions = {
  /**
   * Override the generic constants entirely. Used by the equivalence test to
   * neutralize the provenance multiplier, which has no chain-path counterpart
   * and would otherwise make the two paths differ by construction.
   */
  constants?: RatingConstants;
};

export function agentSnapshotToSubject(s: AgentSnapshot, options: AdapterOptions = {}): Subject {
  const epoch = resolveEpoch(s);
  const observations: Observation[] = [];
  const observers: Record<string, Observer> = Object.create(null);

  // Counterparty satisfaction, from current-epoch non-revoked feedback whose
  // scale could be inferred.
  const seenFeedback = new Set<string>();
  for (const f of s.feedback) {
    if (!inCurrentEpoch(f.block, epoch) || f.is_revoked) continue;
    const key = `${f.client_address}#${f.feedback_index}`;
    if (seenFeedback.has(key)) continue;
    seenFeedback.add(key);
    const valueFx = normalizeValue(f);
    if (valueFx === null) continue;
    observations.push({
      observer_id: f.client_address,
      dimension: "counterparty_satisfaction",
      provenance: "third_party_review",
      value: fxToDecimal(valueFx),
      ts: f.ts,
      observation_key: String(f.feedback_index),
      evidence_ref: null,
    });
  }

  for (const address of new Set(observations.map((o) => o.observer_id))) {
    const r = Object.hasOwn(s.reviewers, address) ? s.reviewers[address] : undefined;
    if (r === undefined) continue; // scoreSubject synthesizes conservatively and counts it
    observers[address] = {
      observer_id: r.address,
      observer_kind: "reviewer",
      first_seen_ts: r.first_seen_ts,
      total_observations: r.total_reviews,
      distinct_subjects: r.distinct_agents_reviewed,
      max_observations_single_day: r.max_reviews_single_day,
      // A shared first funder is the chain's evidence that two reviewers are
      // one voice. That is precisely what independence_group means.
      independence_group: r.funder_address,
      concentration: r.portfolio_top_funder_share,
      has_interaction_with_subject: r.has_commerce_with_agent,
    };
  }

  // Delivery, from settlement records. The counterparty is the observer
  // because independence across counterparties is what makes a delivery record
  // worth anything; the record itself is measured, not reported.
  const commerceByCounterparty = new Map<string, number>();
  for (const m of s.commerce) {
    const n = (commerceByCounterparty.get(m.counterparty) ?? 0) + 1;
    commerceByCounterparty.set(m.counterparty, n);
    observations.push({
      observer_id: m.counterparty,
      dimension: "delivery",
      provenance: "measured",
      value: m.outcome === "completed" ? "1" : "0",
      ts: m.ts,
      observation_key: `commerce:${m.block}:${n}`,
      evidence_ref: null,
    });
    if (!Object.hasOwn(observers, m.counterparty)) {
      observers[m.counterparty] = {
        observer_id: m.counterparty,
        observer_kind: "attester",
        first_seen_ts: m.ts,
        total_observations: 1,
        distinct_subjects: 1,
        max_observations_single_day: 1,
        independence_group: null,
        concentration: "0.000000",
        has_interaction_with_subject: true,
      };
    }
  }
  for (const [addr, n] of commerceByCounterparty) {
    const o = observers[addr];
    if (o !== undefined && o.observer_kind === "attester") o.total_observations = n;
  }

  // Identity integrity: three indicators, each its own observation, all from
  // one observer. capAndSum then holds the index to a single observer's worth
  // of weight, which is correct: three checks by one party are not three
  // independent voices.
  const indexObserverId = `probe:index:${s.chain_slug}`;
  const indicators: Array<[string, boolean]> = [
    ["metadata_resolves", s.metadata_status === "resolved"],
    ["wallet_active", s.agent_wallet_active],
    // Custody that never moved, or moved with linkage evidence that it was a
    // migration rather than a sale (SPEC 11.6).
    ["custody_continuous", s.transfers.length === 0 || epoch.custodyMigrationDetected],
  ];
  for (const [name, ok] of indicators) {
    observations.push({
      observer_id: indexObserverId,
      dimension: "identity_integrity",
      provenance: "measured",
      value: ok ? "1" : "0",
      ts: s.as_of_ts,
      observation_key: name,
      evidence_ref: null,
    });
  }
  observers[indexObserverId] = {
    observer_id: indexObserverId,
    observer_kind: "probe",
    // The index has observed this chain since the agent registered, which is
    // the longest window it can honestly claim for this subject.
    first_seen_ts: s.registered_at,
    total_observations: indicators.length,
    distinct_subjects: 1,
    max_observations_single_day: indicators.length,
    independence_group: null,
    concentration: "0.000000",
    has_interaction_with_subject: false,
  };

  let lastActiveSec: number | null = null;
  let lastActiveTs: string | null = null;
  const consider = (ts: string): void => {
    const t = parseIsoUtcSeconds(ts);
    if (lastActiveSec === null || t > lastActiveSec) {
      lastActiveSec = t;
      lastActiveTs = ts;
    }
  };
  for (const f of s.feedback) if (!f.is_revoked) consider(f.ts);
  for (const v of s.validations) consider(v.ts);
  for (const m of s.commerce) consider(m.ts);

  return {
    subject_version: "1",
    kind: "onchain_agent",
    subject_id: `${s.chain_slug}:${s.agent_id}`,
    source: {
      registry: `erc8004-${s.chain_slug}`,
      ref: s.agent_id,
      url: null,
    },
    profile_id: "onchain_agent.v1",
    as_of_ts: s.as_of_ts,
    first_seen_ts: s.registered_at,
    last_active_ts: lastActiveTs,
    reachable: s.metadata_status === "resolved" && s.declared_endpoints > 0,
    observations,
    observers,
    priors: {
      global: s.priors.global,
      // Chain contexts are tag1 values, which are not dimensions, so they do
      // not map. The one dimension with a chain-side prior is the one the
      // chain prior was computed over.
      by_dimension: { counterparty_satisfaction: s.priors.global },
      basis: s.priors.basis,
      n_basis: s.priors.n_basis,
    },
    constants: options.constants ?? ratingConstantsFromMethodology(s),
  };
}
