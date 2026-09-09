/**
 * FixtureDataSource: the DataSource implementation backing this app
 * end-to-end (protocol: "the app runs with zero infrastructure"). Reads
 * committed AgentSnapshot fixtures and scores them through scoring-port.ts.
 */
import type {
  AgentSnapshot,
  ChainStatsResponse,
  CoverageTier,
  DumpsIndexResponse,
  FeedbackItem,
  HealthResponse,
  LifecycleState,
  ReviewerResponse,
} from "@trust-index/types";
import { KNOWN_CHAINS } from "@trust-index/types";
import type { AgentDetail, AgentSummary, DataSource, FeedbackPage, RecomputeResult } from "./data-source.js";
import { getFixtureByAgent, listFixtures, type LoadedFixture } from "./fixtures.js";
import { clampLimit, paginate } from "./pagination.js";
import { scoreSnapshot } from "./scoring-port.js";

async function scored(fx: LoadedFixture) {
  const { result, source } = await scoreSnapshot(fx.snapshot);
  return { fx, result, source };
}

function toAgentSummary(fx: LoadedFixture, score: Awaited<ReturnType<typeof scoreSnapshot>>["result"]): AgentSummary {
  return {
    chain_slug: fx.snapshot.chain_slug,
    agent_id: fx.snapshot.agent_id,
    name: null,
    lifecycle_state: score.lifecycle_state,
    score: score.score,
    coverage_tier: score.coverage_tier,
  };
}

function indexedThrough(fixtures: LoadedFixture[]): { block: number; ts: string } {
  let block = 0;
  let ts = "1970-01-01T00:00:00Z";
  for (const fx of fixtures) {
    if (fx.snapshot.as_of_block > block) block = fx.snapshot.as_of_block;
    if (fx.snapshot.as_of_ts > ts) ts = fx.snapshot.as_of_ts;
  }
  return { block, ts };
}

export class FixtureDataSource implements DataSource {
  async getAgent(chainSlug: string, agentId: string): Promise<AgentDetail | null> {
    const fx = getFixtureByAgent(chainSlug, agentId);
    if (!fx) return null;
    const { result, source } = await scoreSnapshot(fx.snapshot);
    const snap = fx.snapshot;
    return {
      chain_slug: snap.chain_slug,
      chain_id: snap.chain_id,
      agent_id: snap.agent_id,
      owner_address: snap.owner_address,
      agent_wallet: snap.agent_wallet,
      name: null,
      description: null,
      metadata_status: snap.metadata_status,
      lifecycle_state: result.lifecycle_state,
      registered_at: snap.registered_at,
      ownership_epoch: result.ownership_epoch,
      transfers: snap.transfers,
      score: result,
      score_source: source,
    };
  }

  async getAgentFeedback(
    chainSlug: string,
    agentId: string,
    opts: { cursor: string | null; limit: number },
  ): Promise<FeedbackPage | null> {
    const fx = getFixtureByAgent(chainSlug, agentId);
    if (!fx) return null;
    const { result } = await scoreSnapshot(fx.snapshot);
    const weightByAddress = new Map(result.reviewer_weights.map((r) => [r.address, r.weight]));

    const items: FeedbackItem[] = fx.snapshot.feedback
      .slice()
      .sort((a, b) => (a.ts < b.ts ? 1 : -1))
      .map((f) => {
        let valueNormalized: number | null = null;
        if (f.detected_scale) {
          const min = Number(f.detected_scale.min_raw);
          const max = Number(f.detected_scale.max_raw);
          if (max !== min) {
            valueNormalized = Math.max(0, Math.min(1, (Number(f.value_raw) - min) / (max - min)));
          }
        }
        return {
          client_address: f.client_address,
          feedback_index: f.feedback_index,
          value_normalized: valueNormalized,
          tag1: f.tag1,
          tag2: f.tag2,
          ts: f.ts,
          is_revoked: f.is_revoked,
          reviewer_weight: weightByAddress.get(f.client_address) ?? 0,
          reviewer_profile_url: `/reviewer/${chainSlug}/${f.client_address}`,
        };
      });

    const limit = clampLimit(opts.limit);
    return paginate(items, opts.cursor, limit);
  }

  async getRecompute(chainSlug: string, agentId: string): Promise<RecomputeResult | null> {
    const fx = getFixtureByAgent(chainSlug, agentId);
    if (!fx) return null;
    const { result, source } = await scoreSnapshot(fx.snapshot);
    return {
      agent_id: fx.snapshot.agent_id,
      chain_slug: fx.snapshot.chain_slug,
      as_of_block: fx.snapshot.as_of_block,
      score: result,
      score_source: source,
      priors: fx.snapshot.priors,
    };
  }

  async getReviewer(chainSlug: string, address: string): Promise<ReviewerResponse | null> {
    const lower = address.toLowerCase();
    const fixtures = listFixtures().filter((f) => f.snapshot.chain_slug === chainSlug);
    let snap: AgentSnapshot["reviewers"][string] | undefined;
    const givenValues: number[] = [];

    for (const fx of fixtures) {
      const r = fx.snapshot.reviewers[lower];
      if (r && !snap) snap = r;
      for (const f of fx.snapshot.feedback) {
        if (f.client_address !== lower || !f.detected_scale) continue;
        const min = Number(f.detected_scale.min_raw);
        const max = Number(f.detected_scale.max_raw);
        if (max === min) continue;
        givenValues.push(Math.max(0, Math.min(1, (Number(f.value_raw) - min) / (max - min))));
      }
    }
    if (!snap) return null;

    let meanScoreGiven: number | null = null;
    let scoreVariance: number | null = null;
    if (givenValues.length > 0) {
      const mean = givenValues.reduce((a, b) => a + b, 0) / givenValues.length;
      meanScoreGiven = Math.round(mean * 100 * 100) / 100;
      const variance = givenValues.reduce((a, b) => a + (b - mean) ** 2, 0) / givenValues.length;
      scoreVariance = Math.round(variance * 10000) / 10000;
    }

    return {
      address: snap.address,
      chain_slug: chainSlug,
      first_seen_ts: snap.first_seen_ts,
      total_reviews: snap.total_reviews,
      distinct_agents_reviewed: snap.distinct_agents_reviewed,
      max_reviews_single_day: snap.max_reviews_single_day,
      mean_score_given: meanScoreGiven,
      score_variance: scoreVariance,
      conditions: {
        funder_address: snap.funder_address,
        portfolio_top_funder_share: Number(snap.portfolio_top_funder_share),
        has_commerce_with_agent: snap.has_commerce_with_agent,
      },
    };
  }

  async getReviewerAgents(chainSlug: string, address: string): Promise<AgentSummary[] | null> {
    const lower = address.toLowerCase();
    const fixtures = listFixtures().filter(
      (f) => f.snapshot.chain_slug === chainSlug && f.snapshot.reviewers[lower],
    );
    if (fixtures.length === 0) return null;
    const out: AgentSummary[] = [];
    for (const fx of fixtures) {
      const { result } = await scoreSnapshot(fx.snapshot);
      out.push(toAgentSummary(fx, result));
    }
    return out;
  }

  async getStats(chainSlug: string): Promise<ChainStatsResponse | null> {
    const fixtures = listFixtures().filter((f) => f.snapshot.chain_slug === chainSlug);
    if (fixtures.length === 0) return null;

    const byLifecycle: Record<LifecycleState, number> = {
      placeholder: 0,
      registered: 0,
      live: 0,
      dormant: 0,
    };
    const byTier: Record<CoverageTier, number> = { none: 0, thin: 0, moderate: 0, strong: 0 };
    let feedbackTotal = 0;
    const reviewers = new Set<string>();

    for (const fx of fixtures) {
      const { result } = await scoreSnapshot(fx.snapshot);
      byLifecycle[result.lifecycle_state] += 1;
      byTier[result.coverage_tier] += 1;
      feedbackTotal += fx.snapshot.feedback.length;
      for (const addr of Object.keys(fx.snapshot.reviewers)) reviewers.add(addr);
    }

    const scoreable = fixtures.length - byLifecycle.placeholder;
    const { block } = indexedThrough(fixtures);

    return {
      chain_slug: chainSlug,
      agents_total: fixtures.length,
      agents_by_lifecycle: byLifecycle,
      agents_scoreable: scoreable,
      feedback_total: feedbackTotal,
      reviewers_total: reviewers.size,
      coverage_tiers: byTier,
      indexed_through_block: block,
    };
  }

  async getDumps(): Promise<DumpsIndexResponse> {
    const chains = [...new Set(listFixtures().map((f) => f.snapshot.chain_slug))];
    const tables = ["agents", "feedback", "reviewer_wallets", "scores"];
    const dumps = chains.flatMap((chain_slug) =>
      tables.map((table) => ({
        table,
        chain_slug,
        url: `/dumps/${chain_slug}/${table}.jsonl.gz`,
        sha256: "pending",
        row_count: 0,
        generated_at: "",
      })),
    );
    return {
      dumps,
      manifest_url: "/dumps/manifest.json",
      manifest_sha256: "pending",
    };
  }

  async getHealth(): Promise<HealthResponse> {
    const { block } = indexedThrough(listFixtures());
    return {
      chains: KNOWN_CHAINS.filter((c) => c.enabled).map((c) => ({
        chain_slug: c.slug,
        head_block: block,
        indexed_block: block,
        lag_blocks: 0,
        lag_seconds: 0,
      })),
    };
  }

  async getIndexedThrough(): Promise<{ block: number; ts: string }> {
    return indexedThrough(listFixtures());
  }

  async listAgents(chainSlug: string): Promise<AgentSummary[]> {
    const fixtures = listFixtures().filter((f) => f.snapshot.chain_slug === chainSlug);
    const out: AgentSummary[] = [];
    for (const fx of fixtures) {
      const { result } = await scoreSnapshot(fx.snapshot);
      out.push(toAgentSummary(fx, result));
    }
    return out;
  }
}

export const scoreFixture = scored;
