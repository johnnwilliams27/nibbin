/**
 * Deterministic synthetic cohort generator.
 *
 * This exists to exercise and validate the harness, not to produce results. A
 * synthetic cohort has a planted relationship between evidence and outcomes,
 * so it can answer "does this pipeline detect a signal that is definitely
 * there, and report none when there is none". It says nothing whatever about
 * whether the real index predicts real commerce, and any report generated from
 * it is labeled synthetic.
 *
 * Fully deterministic: a seeded linear congruential generator, no clock, no
 * Math.random, so a rerun reproduces the same cohort.
 */
import { DEFAULT_CONSTANTS, type AgentSnapshot, type FeedbackEntry, type ReviewerSnapshot } from "@trust-index/types";

/** Numerical Recipes LCG. Deterministic and adequate for fixture generation. */
function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(1664525, s) + 1013904223) >>> 0;
    return s / 0x1_0000_0000;
  };
}

const AS_OF_TS = Date.UTC(2026, 7, 1) / 1000;
const AS_OF_BLOCK = 33_600_000;
const BLOCKS_PER_DAY = 43_200;

const daysAgoTs = (d: number): string =>
  new Date((AS_OF_TS - Math.round(d * 86_400)) * 1000).toISOString().replace(".000Z", "Z");
const daysAgoBlock = (d: number): number => AS_OF_BLOCK - Math.round(d * BLOCKS_PER_DAY);
const addr = (n: number): `0x${string}` => (`0x${n.toString(16).padStart(40, "0")}`) as `0x${string}`;

export type SyntheticOptions = {
  agents: number;
  seed: number;
  /**
   * How strongly true quality drives outcomes. 1 means outcomes follow quality
   * exactly; 0 means outcomes are independent of quality, which is the
   * null-signal case the harness must report as no better than chance.
   */
  signalStrength: number;
  /** Split instant, in days before as-of. Feedback lands before it, outcomes after. */
  splitDaysAgo: number;
  /**
   * Fraction of post-split jobs attributed by a moderate (owner) link rather
   * than a strong (agent wallet) one. 0 means every label is strong.
   */
  moderateShare?: number;
  /**
   * When set, moderate-linked outcomes are drawn independently of the agent's
   * true quality, simulating over-attribution: the owner's other business
   * bleeding into the agent's record. Used to prove the arm comparison detects
   * untrustworthy moderate links rather than merely reporting them.
   */
  corruptModerate?: boolean;
};

export type SyntheticCohort = {
  snapshots: AgentSnapshot[];
  splitTs: string;
  splitBlock: number;
  /** The planted quality per agent, for validating the harness. Never an input to scoring. */
  trueQuality: number[];
};

/**
 * Build a cohort where an agent's true quality drives both the feedback its
 * reviewers leave (before the split) and the commerce outcomes it produces
 * (after the split), with reviewer count and age varying independently so the
 * trivial baselines are not trivially correct.
 */
export function syntheticCohort(opts: SyntheticOptions): SyntheticCohort {
  const rand = lcg(opts.seed);
  const snapshots: AgentSnapshot[] = [];
  const trueQuality: number[] = [];

  for (let i = 0; i < opts.agents; i++) {
    const quality = rand();
    trueQuality.push(quality);

    // Reviewer count and wallet age vary independently of quality, so
    // "count the reviews" and "wallet age" have no free ride.
    const reviewerCount = 2 + Math.floor(rand() * 18);
    const ageDays = 40 + Math.floor(rand() * 700);

    const reviewers: Record<string, ReviewerSnapshot> = {};
    const feedback: FeedbackEntry[] = [];

    for (let r = 0; r < reviewerCount; r++) {
      const n = 0x100000 + i * 100 + r;
      const reviewerAgeDays = 30 + Math.floor(rand() * 800);
      reviewers[addr(n)] = {
        address: addr(n),
        first_seen_block: daysAgoBlock(reviewerAgeDays),
        first_seen_ts: daysAgoTs(reviewerAgeDays),
        total_reviews: 1 + Math.floor(rand() * 30),
        distinct_agents_reviewed: 1 + Math.floor(rand() * 25),
        max_reviews_single_day: 1 + Math.floor(rand() * 3),
        funder_address: addr(0x900000 + i * 100 + r),
        portfolio_top_funder_share: "0.200000",
        has_commerce_with_agent: false,
      };

      // Feedback value tracks quality with noise, on a 1-5 star scale.
      const noisy = quality * 0.8 + rand() * 0.2;
      const stars = Math.max(1, Math.min(5, 1 + Math.round(noisy * 4)));
      const daysAgo = opts.splitDaysAgo + 1 + Math.floor(rand() * 120);
      feedback.push({
        client_address: addr(n),
        feedback_index: 0,
        value_raw: String(stars),
        value_decimals: 0,
        tag1: r % 2 === 0 ? "code-review" : "data-feed",
        tag2: "",
        block: daysAgoBlock(daysAgo),
        ts: daysAgoTs(daysAgo),
        is_revoked: false,
        detected_scale: { min_raw: "1", max_raw: "5" },
      });
    }

    // Post-split outcomes: driven by quality at signalStrength, else by noise.
    const jobs = 1 + Math.floor(rand() * 3);
    const commerce = [];
    const moderateShare = opts.moderateShare ?? 0;
    for (let j = 0; j < jobs; j++) {
      const isModerate = rand() < moderateShare;
      const draw = rand();
      // A corrupted moderate link carries an outcome unrelated to this agent's
      // quality, which is exactly what over-attribution looks like in the data.
      const effectiveQuality = isModerate && opts.corruptModerate === true ? rand() : quality;
      const pSuccess = opts.signalStrength * effectiveQuality + (1 - opts.signalStrength) * 0.5;
      const completed = draw < pSuccess;
      const daysAgo = Math.max(0, opts.splitDaysAgo - 1 - Math.floor(rand() * (opts.splitDaysAgo || 1)));
      commerce.push({
        counterparty: addr(0xa00000 + i * 100 + j),
        outcome: (completed ? "completed" : "disputed") as "completed" | "disputed",
        ts: daysAgoTs(daysAgo),
        block: daysAgoBlock(daysAgo),
        linkage_strength: (isModerate ? "moderate" : "strong") as "moderate" | "strong",
      });
    }

    snapshots.push({
      snapshot_version: "1",
      chain_id: 8453,
      chain_slug: "base",
      agent_id: String(100000 + i),
      as_of_block: AS_OF_BLOCK,
      as_of_ts: daysAgoTs(0),
      registered_block: daysAgoBlock(ageDays),
      registered_at: daysAgoTs(ageDays),
      owner_address: addr(0xb00000 + i),
      agent_wallet: addr(0xc00000 + i),
      metadata_status: "resolved",
      declared_endpoints: 2,
      agent_wallet_active: true,
      transfers: [],
      transfer_linkages: [],
      feedback,
      reviewers,
      validations: [],
      commerce,
      priors: {
        global: "0.550000",
        by_context: { "code-review": "0.580000", "data-feed": "0.520000" },
        basis: "high_weight_weighted_mean",
        n_basis: "184.20",
      },
      constants: DEFAULT_CONSTANTS,
    });
  }

  return {
    snapshots,
    splitTs: daysAgoTs(opts.splitDaysAgo),
    splitBlock: daysAgoBlock(opts.splitDaysAgo),
    trueQuality,
  };
}
