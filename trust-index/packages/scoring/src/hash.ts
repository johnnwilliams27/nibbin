/**
 * inputs_hash: sha256 hex of the canonical JSON of the snapshot's
 * scoring-relevant fields (SPEC 22).
 *
 * Included, exactly as they appear in the snapshot (DecimalStrings stay
 * quoted strings, integers stay integers):
 * - identity and frame: chain_id, chain_slug, agent_id, as_of_block,
 *   as_of_ts, registered_block, registered_at, owner_address, agent_wallet
 * - lifecycle inputs: metadata_status, declared_endpoints,
 *   agent_wallet_active
 * - evidence: transfers, transfer_linkages, feedback, reviewers,
 *   validations, commerce
 * - estimator inputs: priors, and every methodology constant VALUE plus
 *   methodology_version, interval_method, confidence_transform
 *
 * Excluded: snapshot_version (shape, not scoring input) and all constant
 * provenance prose (provisional flags, tuning_run, basis). Two snapshots
 * that differ only in provenance prose score identically and hash
 * identically; a changed constant value changes the hash.
 */
import { createHash } from "node:crypto";
import type { AgentSnapshot, CanonicalValue, MethodologyConstants } from "@trust-index/types";
import { canonicalJson } from "@trust-index/types";

function constantValues(c: MethodologyConstants): CanonicalValue {
  return {
    methodology_version: c.methodology_version,
    shrinkage_k: c.shrinkage_k.value,
    decay_half_life_days: c.decay_half_life_days.value,
    weight: {
      age_ramp_days: c.weight.age_ramp_days.value,
      age_floor: c.weight.age_floor.value,
      cohort_window_hours: c.weight.cohort_window_hours.value,
      cohort_penalty: c.weight.cohort_penalty.value,
      common_funder_multiplier: c.weight.common_funder_multiplier.value,
      velocity_threshold_per_day: c.weight.velocity_threshold_per_day.value,
      velocity_multiplier: c.weight.velocity_multiplier.value,
      repeat_bonus_multiplier: c.weight.repeat_bonus_multiplier.value,
      repeat_bonus_cap: c.weight.repeat_bonus_cap.value,
      commerce_multiplier: c.weight.commerce_multiplier.value,
      portfolio_penalty: c.weight.portfolio_penalty.value,
      weight_floor: c.weight.weight_floor.value,
    },
    suppression_neff_floor: c.suppression_neff_floor.value,
    tiers: {
      thin_neff_max: c.tiers.thin_neff_max.value,
      moderate_neff_max: c.tiers.moderate_neff_max.value,
      strong_min_span_days: c.tiers.strong_min_span_days.value,
      strong_min_counterparties: c.tiers.strong_min_counterparties.value,
    },
    lifecycle: {
      live_window_days: c.lifecycle.live_window_days.value,
      dormant_window_days: c.lifecycle.dormant_window_days.value,
    },
    interval_method: c.interval_method,
    confidence_transform: c.confidence_transform,
  };
}

export function scoringInputsCanonical(s: AgentSnapshot): string {
  const tree: CanonicalValue = {
    chain_id: s.chain_id,
    chain_slug: s.chain_slug,
    agent_id: s.agent_id,
    as_of_block: s.as_of_block,
    as_of_ts: s.as_of_ts,
    registered_block: s.registered_block,
    registered_at: s.registered_at,
    owner_address: s.owner_address,
    agent_wallet: s.agent_wallet,
    metadata_status: s.metadata_status,
    declared_endpoints: s.declared_endpoints,
    agent_wallet_active: s.agent_wallet_active,
    transfers: s.transfers.map((t) => ({
      from_address: t.from_address,
      to_address: t.to_address,
      block: t.block,
      ts: t.ts,
      tx_hash: t.tx_hash,
    })),
    transfer_linkages: s.transfer_linkages.map((l) => ({
      transfer_index: l.transfer_index,
      same_funder: l.same_funder,
      bidirectional_history: l.bidirectional_history,
    })),
    feedback: s.feedback.map((f) => ({
      client_address: f.client_address,
      feedback_index: f.feedback_index,
      value_raw: f.value_raw,
      value_decimals: f.value_decimals,
      tag1: f.tag1,
      tag2: f.tag2,
      block: f.block,
      ts: f.ts,
      is_revoked: f.is_revoked,
      detected_scale:
        f.detected_scale === null
          ? null
          : { min_raw: f.detected_scale.min_raw, max_raw: f.detected_scale.max_raw },
    })),
    reviewers: Object.fromEntries(
      Object.keys(s.reviewers)
        .sort()
        .map((address) => {
          const r = s.reviewers[address]!;
          return [
            address,
            {
              address: r.address,
              first_seen_block: r.first_seen_block,
              first_seen_ts: r.first_seen_ts,
              total_reviews: r.total_reviews,
              distinct_agents_reviewed: r.distinct_agents_reviewed,
              max_reviews_single_day: r.max_reviews_single_day,
              funder_address: r.funder_address,
              portfolio_top_funder_share: r.portfolio_top_funder_share,
              has_commerce_with_agent: r.has_commerce_with_agent,
            } satisfies CanonicalValue,
          ];
        }),
    ),
    validations: s.validations.map((v) => ({
      request_hash: v.request_hash,
      validator_address: v.validator_address,
      response: v.response,
      tag: v.tag,
      last_update_block: v.last_update_block,
      ts: v.ts,
    })),
    commerce: s.commerce.map((cr) => ({
      counterparty: cr.counterparty,
      outcome: cr.outcome,
      ts: cr.ts,
      block: cr.block,
    })),
    priors: {
      global: s.priors.global,
      by_context: Object.fromEntries(
        Object.keys(s.priors.by_context)
          .sort()
          .map((k) => [k, s.priors.by_context[k]!]),
      ),
      basis: s.priors.basis,
      n_basis: s.priors.n_basis,
    },
    constants: constantValues(s.constants),
  };
  return canonicalJson(tree);
}

export function inputsHash(s: AgentSnapshot): string {
  return createHash("sha256").update(scoringInputsCanonical(s), "utf8").digest("hex");
}
