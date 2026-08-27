/**
 * DataSource: every API route and every page reads through this interface
 * (protocol requirement). FixtureDataSource is the only working
 * implementation; PostgresDataSource is a stub for @trust-index/db.
 */
import type {
  Address,
  ChainStatsResponse,
  DumpsIndexResponse,
  FeedbackItem,
  HealthResponse,
  LifecycleState,
  MetadataStatus,
  Paginated,
  ReviewerResponse,
  ScoreResult,
  TransferEvent,
} from "@trust-index/types";

/** Everything the agent page and GET /agents/:chain/:id need. */
export type AgentDetail = {
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
  transfers: TransferEvent[];
  score: ScoreResult;
  score_source: "engine" | "synthetic";
};

/** GET /agents/:chain/:id/recompute: the full derivation. */
export type RecomputeResult = {
  agent_id: string;
  chain_slug: string;
  as_of_block: number;
  score: ScoreResult;
  score_source: "engine" | "synthetic";
  priors: {
    global: string;
    by_context: Record<string, string>;
    basis: string;
    n_basis: string;
  };
};

export type AgentSummary = {
  chain_slug: string;
  agent_id: string;
  name: string | null;
  lifecycle_state: LifecycleState;
  score: number | null;
  coverage_tier: ScoreResult["coverage_tier"];
};

export type FeedbackPage = Paginated<FeedbackItem>;

export type DataSource = {
  getAgent(chainSlug: string, agentId: string): Promise<AgentDetail | null>;
  getAgentFeedback(
    chainSlug: string,
    agentId: string,
    opts: { cursor: string | null; limit: number },
  ): Promise<FeedbackPage | null>;
  getRecompute(chainSlug: string, agentId: string): Promise<RecomputeResult | null>;
  getReviewer(chainSlug: string, address: string): Promise<ReviewerResponse | null>;
  getReviewerAgents(chainSlug: string, address: string): Promise<AgentSummary[] | null>;
  getStats(chainSlug: string): Promise<ChainStatsResponse | null>;
  getDumps(): Promise<DumpsIndexResponse>;
  getHealth(): Promise<HealthResponse>;
  listAgents(chainSlug: string): Promise<AgentSummary[]>;
};
