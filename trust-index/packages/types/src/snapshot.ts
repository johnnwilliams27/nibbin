/**
 * AgentSnapshot: the complete, materialized input to the scoring engine
 * (SPEC §7, §11). The engine reads nothing else: no network, no clock, no
 * database. Everything time-dependent is relative to as_of_block/as_of_ts.
 *
 * All fractional numerics are DecimalStrings (see fixed.ts); integers
 * (blocks, counts) are JS safe integers. Addresses are lowercase 0x hex.
 * Timestamps are ISO-8601 UTC with a trailing Z, second precision.
 */
import type { DecimalString } from "./fixed.js";
import type { MethodologyConstants } from "./methodology.js";

export type Address = `0x${string}`;

export type MetadataStatus = "resolved" | "unreachable" | "malformed" | "absent";

export type TransferEvent = {
  from_address: Address;
  to_address: Address;
  block: number;
  ts: string;
  tx_hash: `0x${string}`;
};

/**
 * Evidence that a transfer was a custody migration rather than a sale
 * (SPEC §11.6). Attached per transfer by the index build; the engine only
 * decides whether to preserve the epoch.
 */
export type TransferLinkage = {
  /** Index into `transfers` this evidence refers to. */
  transfer_index: number;
  /** Destination wallet's first funder equals source wallet's first funder. */
  same_funder: boolean;
  /** Source and destination have bidirectional transfer history with each other. */
  bidirectional_history: boolean;
};

export type FeedbackEntry = {
  client_address: Address;
  feedback_index: number;
  /** Raw int128 value as a decimal string (may exceed safe integer range). */
  value_raw: string;
  value_decimals: number;
  tag1: string;
  tag2: string;
  block: number;
  ts: string;
  is_revoked: boolean;
  /**
   * Scale detected for this (client_address, tag1) pair across the whole index
   * (SPEC §11.10), as raw-value bounds. null = scale uninferable; the entry is
   * excluded from scoring and counted as unusable coverage.
   */
  detected_scale: { min_raw: string; max_raw: string } | null;
};

/** Per-reviewer statistics materialized from the reviewer_wallets dataset (SPEC §9, §11.2). */
export type ReviewerSnapshot = {
  address: Address;
  first_seen_block: number;
  first_seen_ts: string;
  total_reviews: number;
  distinct_agents_reviewed: number;
  max_reviews_single_day: number;
  /** First funding source of this wallet; null if none found. */
  funder_address: Address | null;
  /** Share of this reviewer's reviewed agents owned/funded by its single largest funder cluster, [0,1]. */
  portfolio_top_funder_share: DecimalString;
  /** Reviewer has at least one non-feedback on-chain transaction with this agent's wallet. */
  has_commerce_with_agent: boolean;
};

export type ValidationRecord = {
  request_hash: `0x${string}`;
  validator_address: Address;
  /** Raw response value; Validation Registry schema is unstable (SPEC §8), treat as opaque. */
  response: number;
  tag: string;
  last_update_block: number;
  ts: string;
};

/** One commerce interaction involving this agent (Olas / Virtuals ACP ingest, SPEC §12). */
export type CommerceRecord = {
  counterparty: Address;
  outcome: "completed" | "rejected" | "disputed" | "abandoned";
  ts: string;
  block: number;
};

/**
 * Cohort priors the estimate shrinks toward (SPEC §11.0). Computed by the
 * index build from high-weight evidence only; never a raw population mean.
 * Values on the normalized [0,1] scale.
 */
export type PriorSet = {
  /** Global prior, [0,1]. */
  global: DecimalString;
  /** Per-context (tag1) priors, [0,1]. Fall back to global when a context is absent. */
  by_context: Record<string, DecimalString>;
  basis: "high_weight_weighted_mean" | "commerce_corroborated";
  /** Effective sample size behind the prior itself. */
  n_basis: DecimalString;
};

export type AgentSnapshot = {
  snapshot_version: "1";
  chain_id: number;
  chain_slug: string;
  /** uint256 token id as a decimal string. */
  agent_id: string;

  as_of_block: number;
  as_of_ts: string;

  registered_block: number;
  registered_at: string;
  owner_address: Address;
  agent_wallet: Address | null;

  metadata_status: MetadataStatus;
  /** Count of declared service endpoints in resolved metadata; 0 when unresolved. */
  declared_endpoints: number;
  /** Agent wallet has at least one outbound transaction. */
  agent_wallet_active: boolean;

  /** Full ERC-721 transfer history for this token, ascending by block. Mint is not included. */
  transfers: TransferEvent[];
  transfer_linkages: TransferLinkage[];

  /** All feedback across all epochs, ascending by (block, client_address, feedback_index). */
  feedback: FeedbackEntry[];
  /** Reviewer stats for every distinct client_address appearing in feedback. */
  reviewers: Record<string, ReviewerSnapshot>;

  validations: ValidationRecord[];
  commerce: CommerceRecord[];

  priors: PriorSet;
  constants: MethodologyConstants;
};
