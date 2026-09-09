/**
 * Postgres-backed DataSource. Stub: this app ships fixture-backed
 * (protocol requirement, "runs with zero infrastructure"). Wire this up
 * against @trust-index/db (Track A) once that package exists and a
 * DATABASE_URL is configured; see docs/ENVIRONMENT.md.
 *
 * TODO(@trust-index/db): every method below should query the schema in
 * SPEC §9 (agents, feedback, reviewer_wallets, scores, index_cursors) and
 * run each agent's current AgentSnapshot through scoring-port.ts exactly as
 * FixtureDataSource does, so the two sources are drop-in compatible.
 */
import type {
  ChainStatsResponse,
  DumpsIndexResponse,
  HealthResponse,
  ReviewerResponse,
} from "@trust-index/types";
import type { AgentDetail, AgentSummary, DataSource, FeedbackPage, RecomputeResult } from "./data-source.js";

function notImplemented(): never {
  throw new Error(
    "PostgresDataSource is not implemented. TODO: wire against @trust-index/db " +
      "(SPEC §9 schema); see docs/NOTES-track-d.md.",
  );
}

export class PostgresDataSource implements DataSource {
  getAgent(): Promise<AgentDetail | null> {
    notImplemented();
  }
  getAgentFeedback(): Promise<FeedbackPage | null> {
    notImplemented();
  }
  getRecompute(): Promise<RecomputeResult | null> {
    notImplemented();
  }
  getReviewer(): Promise<ReviewerResponse | null> {
    notImplemented();
  }
  getReviewerAgents(): Promise<AgentSummary[] | null> {
    notImplemented();
  }
  getStats(): Promise<ChainStatsResponse | null> {
    notImplemented();
  }
  getDumps(): Promise<DumpsIndexResponse> {
    notImplemented();
  }
  getHealth(): Promise<HealthResponse> {
    notImplemented();
  }
  listAgents(): Promise<AgentSummary[]> {
    notImplemented();
  }
  getIndexedThrough(): Promise<{ block: number; ts: string }> {
    notImplemented();
  }
}
