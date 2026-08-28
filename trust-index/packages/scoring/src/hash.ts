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
 * provenance prose (the provisional flags, tuning_run, and the per-constant
 * `basis` rationale strings; distinct from the prior's `priors.basis`
 * provenance enum, which IS included). Two snapshots that differ only in
 * constant provenance prose score identically and hash identically; a changed
 * constant value changes the hash.
 */
import { createHash } from "node:crypto";
import type { AgentSnapshot, CanonicalValue, MethodologyConstants } from "@trust-index/types";
import { canonicalJson } from "@trust-index/types";

/**
 * Normalize a decimal string so equal values hash equally regardless of
 * trailing zeros or an integer-versus-fixed-point spelling ("5", "5.00" and
 * "5.000000000000" all hash the same). Without this the anchored inputs_hash
 * (SPEC 20.1) would depend on how a constant happened to be typed, breaking
 * the reproduction guarantee for a value the score itself is invariant to.
 */
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

/** Keep the first item for each key, preserving order. Input should already be sorted. */
function dedupeByKey<T>(items: T[], key: (item: T) => string): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const item of items) {
    const k = key(item);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(item);
  }
  return out;
}

function constantValues(c: MethodologyConstants): CanonicalValue {
  const d = canonicalDecimal;
  return {
    methodology_version: c.methodology_version,
    shrinkage_k: d(c.shrinkage_k.value),
    decay_half_life_days: d(c.decay_half_life_days.value),
    weight: {
      age_ramp_days: d(c.weight.age_ramp_days.value),
      age_floor: d(c.weight.age_floor.value),
      cohort_window_hours: d(c.weight.cohort_window_hours.value),
      cohort_penalty: d(c.weight.cohort_penalty.value),
      common_funder_multiplier: d(c.weight.common_funder_multiplier.value),
      velocity_threshold_per_day: d(c.weight.velocity_threshold_per_day.value),
      velocity_multiplier: d(c.weight.velocity_multiplier.value),
      repeat_bonus_multiplier: d(c.weight.repeat_bonus_multiplier.value),
      repeat_bonus_cap: d(c.weight.repeat_bonus_cap.value),
      commerce_multiplier: d(c.weight.commerce_multiplier.value),
      portfolio_penalty: d(c.weight.portfolio_penalty.value),
      weight_floor: d(c.weight.weight_floor.value),
    },
    suppression_neff_floor: d(c.suppression_neff_floor.value),
    tiers: {
      thin_neff_max: d(c.tiers.thin_neff_max.value),
      moderate_neff_max: d(c.tiers.moderate_neff_max.value),
      strong_min_span_days: d(c.tiers.strong_min_span_days.value),
      strong_min_counterparties: d(c.tiers.strong_min_counterparties.value),
    },
    lifecycle: {
      live_window_days: d(c.lifecycle.live_window_days.value),
      dormant_window_days: d(c.lifecycle.dormant_window_days.value),
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
    // Every array is sorted into a canonical order before hashing. The score
    // is fully order-independent (SPEC 22), so its anchored inputs_hash must be
    // too, or two honest reproducers of the same evidence would compute
    // different roots.
    transfers: [...s.transfers]
      .sort(
        (a, b) =>
          a.block - b.block ||
          cmp(a.tx_hash, b.tx_hash) ||
          cmp(a.from_address, b.from_address) ||
          cmp(a.to_address, b.to_address),
      )
      .map((t) => ({
        from_address: t.from_address,
        to_address: t.to_address,
        block: t.block,
        ts: t.ts,
        tx_hash: t.tx_hash,
      })),
    transfer_linkages: [...s.transfer_linkages]
      .sort((a, b) => a.transfer_index - b.transfer_index)
      .map((l) => ({
        transfer_index: l.transfer_index,
        same_funder: l.same_funder,
        bidirectional_history: l.bidirectional_history,
      })),
    // Dedupe by the (client_address, feedback_index) primary key, exactly as
    // the estimator does (index.ts), so a transient duplicate from a reorg or
    // backfill replay (SPEC 10.1) produces the same inputs_hash as a clean
    // index. Without this the hash would diverge for two honest reproducers
    // whose scores are identical.
    feedback: dedupeByKey(
      [...s.feedback].sort(
        (a, b) => cmp(a.client_address, b.client_address) || a.feedback_index - b.feedback_index,
      ),
      (f) => `${f.client_address}#${f.feedback_index}`,
    )
      .map((f) => ({
        client_address: f.client_address,
        feedback_index: f.feedback_index,
        value_raw: canonicalDecimal(f.value_raw),
        value_decimals: f.value_decimals,
        tag1: f.tag1,
        tag2: f.tag2,
        block: f.block,
        ts: f.ts,
        is_revoked: f.is_revoked,
        detected_scale:
          f.detected_scale === null
            ? null
            : {
                min_raw: canonicalDecimal(f.detected_scale.min_raw),
                max_raw: canonicalDecimal(f.detected_scale.max_raw),
              },
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
              portfolio_top_funder_share: canonicalDecimal(r.portfolio_top_funder_share),
              has_commerce_with_agent: r.has_commerce_with_agent,
            } satisfies CanonicalValue,
          ];
        }),
    ),
    validations: [...s.validations]
      .sort((a, b) => cmp(a.request_hash, b.request_hash) || cmp(a.validator_address, b.validator_address))
      .map((v) => ({
        request_hash: v.request_hash,
        validator_address: v.validator_address,
        response: v.response,
        tag: v.tag,
        last_update_block: v.last_update_block,
        ts: v.ts,
      })),
    commerce: [...s.commerce]
      .sort((a, b) => a.block - b.block || cmp(a.counterparty, b.counterparty) || cmp(a.ts, b.ts) || cmp(a.outcome, b.outcome))
      .map((cr) => ({
        counterparty: cr.counterparty,
        outcome: cr.outcome,
        ts: cr.ts,
        block: cr.block,
      })),
    priors: {
      global: canonicalDecimal(s.priors.global),
      by_context: Object.fromEntries(
        Object.keys(s.priors.by_context)
          .sort()
          .map((k) => [k, canonicalDecimal(s.priors.by_context[k]!)]),
      ),
      basis: s.priors.basis,
      n_basis: canonicalDecimal(s.priors.n_basis),
    },
    constants: constantValues(s.constants),
  };
  return canonicalJson(tree);
}

export function inputsHash(s: AgentSnapshot): string {
  return createHash("sha256").update(scoringInputsCanonical(s), "utf8").digest("hex");
}
