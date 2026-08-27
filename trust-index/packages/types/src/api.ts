/** API response envelopes (SPEC §13). Response shapes are versioned by path, never by methodology. */
import type { CoverageTier, LifecycleState, ScoreResult } from "./score.js";
import type { Address, MetadataStatus } from "./snapshot.js";

export type ApiMeta = {
  methodology_version: string;
  indexed_through_block: number;
  indexed_through_ts: string;
  /**
   * Mandatory and non-empty when the enclosed score's coverage_tier is
   * "none" or "thin" (SPEC §13, fixes §3.5). Absent otherwise.
   */
  coverage_disclaimer?: string;
  /** True while any served constant is provisional (SPEC §12). */
  constants_provisional: boolean;
};

export type ApiEnvelope<T> = {
  data: T;
  meta: ApiMeta;
};

export type ApiError = {
  error: {
    code:
      | "not_found"
      | "invalid_request"
      | "rate_limited"
      | "chain_not_indexed"
      | "internal";
    message: string;
  };
  meta?: Partial<ApiMeta>;
};

/** GET /agents/:chain/:id */
export type AgentResponse = {
  chain_slug: string;
  chain_id: number;
  agent_id: string;
  owner_address: Address;
  agent_wallet: Address | null;
  name: string | null;
  description: string | null;
  metadata_status: MetadataStatus;
  lifecycle_state: LifecycleState;
  registered_at: string;
  ownership_epoch: number;
  score: ScoreResult;
};

/** GET /agents/:chain/:id/feedback (paginated) */
export type FeedbackItem = {
  client_address: Address;
  feedback_index: number;
  value_normalized: number | null;
  tag1: string;
  tag2: string;
  ts: string;
  is_revoked: boolean;
  /** Reviewer quality inline (SPEC §13). */
  reviewer_weight: number;
  reviewer_profile_url: string;
};

export type Paginated<T> = {
  items: T[];
  next_cursor: string | null;
  total: number;
};

/** GET /reviewers/:chain/:address */
export type ReviewerResponse = {
  address: Address;
  chain_slug: string;
  first_seen_ts: string | null;
  total_reviews: number;
  distinct_agents_reviewed: number;
  max_reviews_single_day: number;
  mean_score_given: number | null;
  score_variance: number | null;
  /** Observable conditions with numbers, never intent (SPEC §5.5, §16). */
  conditions: Record<string, number | string | boolean | null>;
};

/** GET /stats/:chain */
export type ChainStatsResponse = {
  chain_slug: string;
  agents_total: number;
  agents_by_lifecycle: Record<LifecycleState, number>;
  /** Placeholder-excluded counts are the headline (SPEC §11.7). */
  agents_scoreable: number;
  feedback_total: number;
  reviewers_total: number;
  coverage_tiers: Record<CoverageTier, number>;
  indexed_through_block: number;
};

/** GET /health */
export type HealthResponse = {
  chains: Array<{
    chain_slug: string;
    head_block: number;
    indexed_block: number;
    lag_blocks: number;
    lag_seconds: number;
  }>;
};

/** GET /dumps */
export type DumpsIndexResponse = {
  dumps: Array<{
    table: string;
    chain_slug: string;
    url: string;
    sha256: string;
    row_count: number;
    generated_at: string;
  }>;
  manifest_url: string;
  manifest_sha256: string;
};

/** MCP tool names exposed at POST /mcp (SPEC §13). */
export const MCP_TOOLS = [
  "get_agent_score",
  "get_agent_feedback",
  "recompute",
  "get_reviewer_profile",
  "compare_agents",
  "get_ecosystem_stats",
  "get_proof",
] as const;
export type McpToolName = (typeof MCP_TOOLS)[number];
