/**
 * Loads an AgentSnapshot fixture into the canonical store, row by row, the
 * way the indexer and enrichment passes would have written it. Used by the
 * round-trip gate test: rows in, buildAgentSnapshot out, deep equality with
 * the fixture.
 */
import type { AgentSnapshot } from "@trust-index/types";
import { sql } from "drizzle-orm";
import type { Db } from "../src/index.js";
import {
  agent_transfers,
  agents,
  commerce_events,
  detected_scales,
  feedback,
  priors,
  reviewer_agent_commerce,
  reviewer_wallets,
  validations,
} from "../src/index.js";

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

/** Remove all per-agent data, keeping the chains seed. */
export async function truncateAgentData(db: Db): Promise<void> {
  await db.execute(sql`
    truncate table
      agents, agent_transfers, feedback, feedback_responses, validations,
      reviewer_wallets, scores, score_overrides, priors, detected_scales,
      reviewer_agent_commerce, commerce_events, index_cursors
  `);
}

function fakeTxHash(prefix: string, n: number): string {
  const body = `${prefix}${n.toString(16)}`;
  return "0x" + body.padStart(64, "0");
}

export async function insertFixture(db: Db, fix: AgentSnapshot): Promise<void> {
  const now = new Date();

  // The indexer would fabricate services from resolved metadata; the snapshot
  // only carries the count, so synthesize an array of that length.
  const services =
    fix.metadata_status === "resolved"
      ? Array.from({ length: fix.declared_endpoints }, (_, i) => ({
          type: "web",
          endpoint: `https://agent.invalid/${i}`,
        }))
      : null;

  await db.insert(agents).values({
    chain_id: fix.chain_id,
    agent_id: fix.agent_id,
    owner_address: fix.owner_address,
    agent_wallet: fix.agent_wallet,
    token_uri: fix.metadata_status === "absent" ? null : "ipfs://fixture",
    registered_block: fix.registered_block,
    registered_at: new Date(fix.registered_at),
    last_seen_block: fix.as_of_block,
    metadata_status: fix.metadata_status,
    services_json: services,
    lifecycle_state: "registered",
    agent_wallet_active: fix.agent_wallet_active,
  });

  // Mint row: buildAgentSnapshot must exclude it from transfers.
  const mintTo = fix.transfers[0]?.from_address ?? fix.owner_address;
  await db.insert(agent_transfers).values({
    chain_id: fix.chain_id,
    agent_id: fix.agent_id,
    from_address: ZERO_ADDRESS,
    to_address: mintTo,
    block: fix.registered_block,
    ts: new Date(fix.registered_at),
    tx_hash: fakeTxHash("a0", 0),
    log_index: 0,
  });

  const linkageByIndex = new Map(fix.transfer_linkages.map((l) => [l.transfer_index, l]));
  for (const [i, t] of fix.transfers.entries()) {
    const linkage = linkageByIndex.get(i);
    await db.insert(agent_transfers).values({
      chain_id: fix.chain_id,
      agent_id: fix.agent_id,
      from_address: t.from_address,
      to_address: t.to_address,
      block: t.block,
      ts: new Date(t.ts),
      tx_hash: t.tx_hash,
      log_index: 1,
      same_funder: linkage?.same_funder ?? null,
      bidirectional_history: linkage?.bidirectional_history ?? null,
    });
  }

  for (const [i, f] of fix.feedback.entries()) {
    await db.insert(feedback).values({
      chain_id: fix.chain_id,
      agent_id: fix.agent_id,
      client_address: f.client_address,
      feedback_index: f.feedback_index,
      value_raw: f.value_raw,
      value_decimals: f.value_decimals,
      tag1: f.tag1,
      tag2: f.tag2,
      block: f.block,
      ts: new Date(f.ts),
      tx_hash: fakeTxHash("fb", i),
      is_revoked: f.is_revoked,
    });
  }

  // Detected scales are an index-wide aggregate per (client, tag1); a null
  // scale in the fixture means no row exists.
  const seenScales = new Set<string>();
  for (const f of fix.feedback) {
    if (f.detected_scale === null) continue;
    const key = `${f.client_address} ${f.tag1}`;
    if (seenScales.has(key)) continue;
    seenScales.add(key);
    await db.insert(detected_scales).values({
      chain_id: fix.chain_id,
      client_address: f.client_address,
      tag1: f.tag1,
      min_raw: f.detected_scale.min_raw,
      max_raw: f.detected_scale.max_raw,
      computed_at: now,
    });
  }

  for (const r of Object.values(fix.reviewers)) {
    await db.insert(reviewer_wallets).values({
      chain_id: fix.chain_id,
      address: r.address,
      first_seen_block: r.first_seen_block,
      first_seen_ts: new Date(r.first_seen_ts),
      first_seen_source: "outbound_tx",
      total_reviews: r.total_reviews,
      distinct_agents_reviewed: r.distinct_agents_reviewed,
      max_reviews_single_day: r.max_reviews_single_day,
      funder_address: r.funder_address,
      portfolio_top_funder_share: r.portfolio_top_funder_share,
      last_computed_at: now,
    });
    if (r.has_commerce_with_agent) {
      await db.insert(reviewer_agent_commerce).values({
        chain_id: fix.chain_id,
        address: r.address,
        agent_id: fix.agent_id,
        evidence_source: "wallet_transfer",
        first_block: r.first_seen_block,
      });
    }
  }

  for (const [i, v] of fix.validations.entries()) {
    await db.insert(validations).values({
      chain_id: fix.chain_id,
      request_hash: v.request_hash,
      validator_address: v.validator_address,
      agent_id: fix.agent_id,
      response: v.response,
      tag: v.tag,
      last_update_block: v.last_update_block,
      ts: new Date(v.ts),
    });
    void i;
  }

  for (const [i, c] of fix.commerce.entries()) {
    await db.insert(commerce_events).values({
      chain_id: fix.chain_id,
      agent_id: fix.agent_id,
      counterparty: c.counterparty,
      outcome: c.outcome,
      block: c.block,
      ts: new Date(c.ts),
      source: "olas",
      tx_hash: fakeTxHash("ce", i),
    });
  }

  await db.insert(priors).values({
    chain_id: fix.chain_id,
    methodology_version: fix.constants.methodology_version,
    context: "",
    value: fix.priors.global,
    basis: fix.priors.basis,
    n_basis: fix.priors.n_basis,
    computed_at: now,
  });
  for (const [context, value] of Object.entries(fix.priors.by_context)) {
    await db.insert(priors).values({
      chain_id: fix.chain_id,
      methodology_version: fix.constants.methodology_version,
      context,
      value,
      basis: fix.priors.basis,
      n_basis: fix.priors.n_basis,
      computed_at: now,
    });
  }
}
