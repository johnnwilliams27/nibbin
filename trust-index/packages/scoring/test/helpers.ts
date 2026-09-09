/** Shared test fixture builder: a minimal, valid AgentSnapshot with everything overridable. */
import { DEFAULT_CONSTANTS, type AgentSnapshot } from "@trust-index/types";

export function makeSnapshot(overrides: Partial<AgentSnapshot> = {}): AgentSnapshot {
  return {
    snapshot_version: "1",
    chain_id: 8453,
    chain_slug: "base",
    agent_id: "1",
    as_of_block: 1000,
    as_of_ts: "2026-08-01T00:00:00Z",
    registered_block: 100,
    registered_at: "2026-01-01T00:00:00Z",
    owner_address: "0x0000000000000000000000000000000000000a",
    agent_wallet: "0x0000000000000000000000000000000000000b",
    metadata_status: "resolved",
    declared_endpoints: 1,
    agent_wallet_active: true,
    transfers: [],
    transfer_linkages: [],
    feedback: [],
    reviewers: {},
    validations: [],
    commerce: [],
    priors: {
      global: "0.550000",
      by_context: { "code-review": "0.580000" },
      basis: "high_weight_weighted_mean",
      n_basis: "100.00",
    },
    constants: DEFAULT_CONSTANTS,
    ...overrides,
  };
}
