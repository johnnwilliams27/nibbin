/**
 * Deterministic generator for the synthetic AgentSnapshot fixture set
 * (SPEC §18.0). Run with: pnpm fixtures:generate
 *
 * Every value is derived from fixed constants; rerunning produces identical
 * bytes. Golden ScoreResult outputs are produced by the scoring engine
 * (Track B) into fixtures/golden/, never by this script.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  DEFAULT_CONSTANTS,
  type Address,
  type AgentSnapshot,
  type FeedbackEntry,
  type FixtureManifest,
  type ReviewerSnapshot,
  type TransferEvent,
} from "@trust-index/types";

const OUT = join(dirname(fileURLToPath(import.meta.url)), "snapshots");
mkdirSync(OUT, { recursive: true });

// Fixed reference frame: Base mainnet, 2s blocks, as-of 2026-08-01T00:00:00Z.
const AS_OF_TS = Date.UTC(2026, 7, 1) / 1000; // seconds
const AS_OF_BLOCK = 33_600_000;
const BLOCKS_PER_DAY = 43_200;

const daysAgoTs = (days: number): string =>
  new Date((AS_OF_TS - Math.round(days * 86_400)) * 1000).toISOString().replace(".000Z", "Z");
const daysAgoBlock = (days: number): number => AS_OF_BLOCK - Math.round(days * BLOCKS_PER_DAY);

const addr = (n: number): Address =>
  ("0x" + n.toString(16).padStart(40, "0")) as Address;
const txh = (n: number): `0x${string}` =>
  ("0x" + n.toString(16).padStart(64, "0")) as `0x${string}`;

type ReviewerSpec = {
  n: number; // address seed
  ageDays: number;
  totalReviews: number;
  distinctAgents: number;
  maxPerDay: number;
  funder: number | null; // funder address seed
  portfolioShare: string;
  commerce: boolean;
};

function reviewer(s: ReviewerSpec): ReviewerSnapshot {
  return {
    address: addr(s.n),
    first_seen_block: daysAgoBlock(s.ageDays),
    first_seen_ts: daysAgoTs(s.ageDays),
    total_reviews: s.totalReviews,
    distinct_agents_reviewed: s.distinctAgents,
    max_reviews_single_day: s.maxPerDay,
    funder_address: s.funder === null ? null : addr(s.funder),
    portfolio_top_funder_share: s.portfolioShare,
    has_commerce_with_agent: s.commerce,
  };
}

type FeedbackSpec = {
  reviewerN: number;
  index: number;
  raw: string; // raw value on the client's scale
  scale: { min: string; max: string } | null;
  tag1: string;
  daysAgo: number;
  seq: number; // tx seed
};

function feedback(s: FeedbackSpec): FeedbackEntry {
  return {
    client_address: addr(s.reviewerN),
    feedback_index: s.index,
    value_raw: s.raw,
    value_decimals: 0,
    tag1: s.tag1,
    tag2: "",
    block: daysAgoBlock(s.daysAgo),
    ts: daysAgoTs(s.daysAgo),
    is_revoked: false,
    detected_scale: s.scale === null ? null : { min_raw: s.scale.min, max_raw: s.scale.max },
  };
}

const FIVE_STAR = { min: "1", max: "5" };

function base(agentId: string, over: Partial<AgentSnapshot>): AgentSnapshot {
  return {
    snapshot_version: "1",
    chain_id: 8453,
    chain_slug: "base",
    agent_id: agentId,
    as_of_block: AS_OF_BLOCK,
    as_of_ts: daysAgoTs(0),
    registered_block: daysAgoBlock(400),
    registered_at: daysAgoTs(400),
    owner_address: addr(0xa0000 + Number(agentId)),
    agent_wallet: addr(0xb0000 + Number(agentId)),
    metadata_status: "resolved",
    declared_endpoints: 2,
    agent_wallet_active: true,
    transfers: [],
    transfer_linkages: [],
    feedback: [],
    reviewers: {},
    validations: [],
    commerce: [],
    priors: {
      global: "0.550000",
      by_context: { "code-review": "0.580000", "data-feed": "0.520000" },
      basis: "high_weight_weighted_mean",
      n_basis: "184.20",
    },
    constants: DEFAULT_CONSTANTS,
    ...over,
  };
}

const fixtures: Record<string, AgentSnapshot> = {};

// 1. placeholder (UC-4): reserved identity, nothing behind it.
fixtures["placeholder"] = base("9001", {
  registered_block: daysAgoBlock(30),
  registered_at: daysAgoTs(30),
  metadata_status: "absent",
  declared_endpoints: 0,
  agent_wallet: null,
  agent_wallet_active: false,
});

// 2. registered, no interaction history: metadata resolves, endpoints declared.
fixtures["registered-no-history"] = base("9002", {
  registered_block: daysAgoBlock(15),
  registered_at: daysAgoTs(15),
});

// 3. thin-same-day-cohort (UC-1): six five-star reviews from two wallets
// created 18 hours apart, zero commerce. Wallet ages are set so the case
// lands in the thin tier rather than under the suppression floor: the point
// of UC-1 is a present score with a wide interval and low confidence.
{
  const r1 = 0x1001;
  const r2 = 0x1002;
  fixtures["thin-same-day-cohort"] = base("9003", {
    registered_block: daysAgoBlock(60),
    registered_at: daysAgoTs(60),
    reviewers: {
      [addr(r1)]: reviewer({
        n: r1, ageDays: 400.0, totalReviews: 3, distinctAgents: 1, maxPerDay: 2,
        funder: 0x2001, portfolioShare: "0.6000", commerce: false,
      }),
      [addr(r2)]: reviewer({
        n: r2, ageDays: 400.75, totalReviews: 3, distinctAgents: 1, maxPerDay: 2,
        funder: 0x2002, portfolioShare: "0.6000", commerce: false,
      }),
    },
    feedback: [
      feedback({ reviewerN: r1, index: 0, raw: "5", scale: FIVE_STAR, tag1: "code-review", daysAgo: 18, seq: 1 }),
      feedback({ reviewerN: r1, index: 1, raw: "5", scale: FIVE_STAR, tag1: "code-review", daysAgo: 15, seq: 2 }),
      feedback({ reviewerN: r1, index: 2, raw: "5", scale: FIVE_STAR, tag1: "code-review", daysAgo: 12, seq: 3 }),
      feedback({ reviewerN: r2, index: 0, raw: "5", scale: FIVE_STAR, tag1: "code-review", daysAgo: 17, seq: 4 }),
      feedback({ reviewerN: r2, index: 1, raw: "5", scale: FIVE_STAR, tag1: "code-review", daysAgo: 14, seq: 5 }),
      feedback({ reviewerN: r2, index: 2, raw: "4", scale: FIVE_STAR, tag1: "code-review", daysAgo: 10, seq: 6 }),
    ],
  });
}

// 4. transferred-identity (UC-2): 800-day-old identity, 40 aged reviews, sold
// 11 days ago (no linkage evidence). Post-transfer: 3 reviews from young wallets.
{
  const olds: FeedbackEntry[] = [];
  const revs: Record<string, ReviewerSnapshot> = {};
  for (let i = 0; i < 40; i++) {
    const n = 0x3000 + i;
    revs[addr(n)] = reviewer({
      n, ageDays: 500 + i * 5, totalReviews: 20 + i, distinctAgents: 15 + i, maxPerDay: 3,
      funder: 0x4000 + i, portfolioShare: "0.2000", commerce: i % 3 === 0,
    });
    olds.push(
      feedback({
        reviewerN: n, index: 0, raw: i % 5 === 0 ? "4" : "5", scale: FIVE_STAR,
        tag1: i % 2 === 0 ? "code-review" : "data-feed", daysAgo: 280 - i * 6, seq: 100 + i,
      }),
    );
  }
  for (let i = 0; i < 3; i++) {
    const n = 0x5000 + i;
    revs[addr(n)] = reviewer({
      n, ageDays: 9 - i, totalReviews: 1, distinctAgents: 1, maxPerDay: 1,
      funder: 0x6000, portfolioShare: "1.0000", commerce: false,
    });
    olds.push(
      feedback({ reviewerN: n, index: 0, raw: "5", scale: FIVE_STAR, tag1: "code-review", daysAgo: 8 - i, seq: 200 + i }),
    );
  }
  const transfer: TransferEvent = {
    from_address: addr(0xa0000 + 9004),
    to_address: addr(0xa9999),
    block: daysAgoBlock(11),
    ts: daysAgoTs(11),
    tx_hash: txh(9004),
  };
  fixtures["transferred-identity"] = base("9004", {
    registered_block: daysAgoBlock(800),
    registered_at: daysAgoTs(800),
    owner_address: addr(0xa9999),
    transfers: [transfer],
    transfer_linkages: [
      { transfer_index: 0, same_funder: false, bidirectional_history: false },
    ],
    reviewers: revs,
    feedback: olds,
  });
}

// 5. custody-migration: same identity shape, but the transfer carries
// same-funder linkage evidence; the epoch is preserved (SPEC §11.6).
{
  const src = fixtures["transferred-identity"]!;
  fixtures["custody-migration"] = {
    ...src,
    agent_id: "9005",
    owner_address: addr(0xa8888),
    transfers: [
      { ...src.transfers[0]!, from_address: addr(0xa0000 + 9005), to_address: addr(0xa8888), tx_hash: txh(9005) },
    ],
    transfer_linkages: [
      { transfer_index: 0, same_funder: true, bidirectional_history: true },
    ],
  };
}

// 6. strong-diverse: 38 aged, independently funded reviewers with recent
// feedback spanning over 100 days; 12 commerce-corroborated; repeat
// business present. Ages sit past the ramp and feedback stays recent so
// the case clears the strong tier's n_eff threshold under decay.
{
  const revs: Record<string, ReviewerSnapshot> = {};
  const fb: FeedbackEntry[] = [];
  for (let i = 0; i < 38; i++) {
    const n = 0x7000 + i;
    revs[addr(n)] = reviewer({
      n, ageDays: 400 + i * 15, totalReviews: 10 + i, distinctAgents: 8 + i, maxPerDay: 2,
      funder: 0x8000 + i, portfolioShare: "0.0500", commerce: i < 12,
    });
    fb.push(
      feedback({
        reviewerN: n, index: 0, raw: i % 7 === 0 ? "3" : i % 3 === 0 ? "4" : "5",
        scale: FIVE_STAR, tag1: i % 2 === 0 ? "code-review" : "data-feed",
        daysAgo: 118 - i * 2.3, seq: 300 + i,
      }),
    );
    if (i < 8) {
      fb.push(
        feedback({
          reviewerN: n, index: 1, raw: "5", scale: FIVE_STAR,
          tag1: i % 2 === 0 ? "code-review" : "data-feed", daysAgo: 25 - i * 2, seq: 400 + i,
        }),
      );
    }
  }
  fixtures["strong-diverse"] = base("9006", {
    registered_block: daysAgoBlock(700),
    registered_at: daysAgoTs(700),
    reviewers: revs,
    feedback: fb,
    commerce: Array.from({ length: 12 }, (_, i) => ({
      counterparty: addr(0x7000 + i),
      outcome: "completed" as const,
      ts: daysAgoTs(250 - i * 15),
      block: daysAgoBlock(250 - i * 15),
    })),
  });
}

// 7. common-funder-ring: twenty reviewers, one shared first funder.
{
  const revs: Record<string, ReviewerSnapshot> = {};
  const fb: FeedbackEntry[] = [];
  for (let i = 0; i < 20; i++) {
    const n = 0x9000 + i;
    revs[addr(n)] = reviewer({
      n, ageDays: 100 + i, totalReviews: 5, distinctAgents: 4, maxPerDay: 3,
      funder: 0xf00d, portfolioShare: "0.9000", commerce: false,
    });
    fb.push(
      feedback({ reviewerN: n, index: 0, raw: "5", scale: FIVE_STAR, tag1: "data-feed", daysAgo: 90 - i * 4, seq: 500 + i }),
    );
  }
  fixtures["common-funder-ring"] = base("9007", {
    reviewers: revs,
    feedback: fb,
  });
}

// 8. bulk-reviewer: one wallet with 10,000 lifetime reviews at 510/day max
// alongside four ordinary reviewers.
{
  const revs: Record<string, ReviewerSnapshot> = {};
  const fb: FeedbackEntry[] = [];
  const bulk = 0xb111;
  revs[addr(bulk)] = reviewer({
    n: bulk, ageDays: 300, totalReviews: 10_000, distinctAgents: 9_800, maxPerDay: 510,
    funder: 0xc001, portfolioShare: "0.3000", commerce: false,
  });
  fb.push(feedback({ reviewerN: bulk, index: 0, raw: "5", scale: FIVE_STAR, tag1: "code-review", daysAgo: 30, seq: 600 }));
  for (let i = 0; i < 4; i++) {
    const n = 0xb200 + i;
    revs[addr(n)] = reviewer({
      n, ageDays: 400 + i * 30, totalReviews: 12, distinctAgents: 10, maxPerDay: 2,
      funder: 0xc100 + i, portfolioShare: "0.1000", commerce: i === 0,
    });
    fb.push(
      feedback({ reviewerN: n, index: 0, raw: i === 3 ? "4" : "5", scale: FIVE_STAR, tag1: "code-review", daysAgo: 100 - i * 20, seq: 610 + i }),
    );
  }
  fixtures["bulk-reviewer"] = base("9008", { reviewers: revs, feedback: fb });
}

// 9. unparseable-scale (SPEC §11.10): every entry's scale uninferable.
{
  const revs: Record<string, ReviewerSnapshot> = {};
  const fb: FeedbackEntry[] = [];
  for (let i = 0; i < 3; i++) {
    const n = 0xd000 + i;
    revs[addr(n)] = reviewer({
      n, ageDays: 250 + i * 10, totalReviews: 6, distinctAgents: 5, maxPerDay: 2,
      funder: 0xe000 + i, portfolioShare: "0.2000", commerce: false,
    });
    fb.push(
      feedback({ reviewerN: n, index: 0, raw: String(7 + i * 31), scale: null, tag1: "code-review", daysAgo: 40 - i * 10, seq: 700 + i }),
    );
  }
  fixtures["unparseable-scale"] = base("9009", { reviewers: revs, feedback: fb });
}

// 10. dormant: was live, nothing for 210 days; feedback decays but exists.
{
  const revs: Record<string, ReviewerSnapshot> = {};
  const fb: FeedbackEntry[] = [];
  for (let i = 0; i < 8; i++) {
    const n = 0xda00 + i;
    revs[addr(n)] = reviewer({
      n, ageDays: 600 + i * 15, totalReviews: 30, distinctAgents: 25, maxPerDay: 2,
      funder: 0xdb00 + i, portfolioShare: "0.1000", commerce: i % 2 === 0,
    });
    fb.push(
      feedback({ reviewerN: n, index: 0, raw: "4", scale: FIVE_STAR, tag1: "data-feed", daysAgo: 210 + i * 12, seq: 800 + i }),
    );
  }
  fixtures["dormant"] = base("9010", { reviewers: revs, feedback: fb });
}

// 11. heavy-decay-flood: one reviewer, 40 reviews all ~600 days old. Exercises
// the anti-flooding cap under heavy time decay: the reviewer's many stale
// reviews must not climb back to a fresh reviewer's weight (SPEC 11.4). Pairs
// with a second reviewer holding a single recent review as a reference point.
{
  const revs: Record<string, ReviewerSnapshot> = {};
  const fb: FeedbackEntry[] = [];
  const flood = 0xf100;
  revs[addr(flood)] = reviewer({
    n: flood, ageDays: 700, totalReviews: 40, distinctAgents: 1, maxPerDay: 3,
    funder: 0xf200, portfolioShare: "0.1000", commerce: false,
  });
  for (let i = 0; i < 40; i++) {
    fb.push(
      feedback({ reviewerN: flood, index: i, raw: "5", scale: FIVE_STAR, tag1: "data-feed", daysAgo: 620 - i * 0.5, seq: 900 + i }),
    );
  }
  const recent = 0xf300;
  revs[addr(recent)] = reviewer({
    n: recent, ageDays: 500, totalReviews: 1, distinctAgents: 1, maxPerDay: 1,
    funder: 0xf400, portfolioShare: "0.1000", commerce: false,
  });
  fb.push(feedback({ reviewerN: recent, index: 0, raw: "5", scale: FIVE_STAR, tag1: "data-feed", daysAgo: 5, seq: 999 }));
  fixtures["heavy-decay-flood"] = base("9011", { reviewers: revs, feedback: fb });
}

const manifest: FixtureManifest = {
  manifest_version: "1",
  cases: {
    "placeholder": {
      snapshot: "placeholder.json", golden: null,
      covers: "UC-4, SPEC 11.7: reserved identity, nothing behind it",
      invariants: [
        "lifecycle_state = placeholder",
        "score, score_low, score_high all null",
        "coverage_tier = none",
        "suppression_reason references placeholder",
      ],
    },
    "registered-no-history": {
      snapshot: "registered-no-history.json", golden: null,
      covers: "SPEC 11.7/11.8: cold start with resolvable endpoints",
      invariants: [
        "lifecycle_state = registered",
        "score null with n_eff = 0",
        "coverage_tier = none",
      ],
    },
    "thin-same-day-cohort": {
      snapshot: "thin-same-day-cohort.json", golden: null,
      covers: "UC-1, SPEC 11.0/11.2: two-wallet same-cohort five-star burst",
      invariants: [
        "coverage_tier = thin",
        "n_eff well below raw review count of 6",
        "score strictly between prior*100 and the raw mean",
        "interval width > 20 points",
        "signals.reviewer_cohort_same_day = 1.0000",
      ],
    },
    "transferred-identity": {
      snapshot: "transferred-identity.json", golden: null,
      covers: "UC-2, SPEC 11.6: purchased identity, epoch reset",
      invariants: [
        "ownership_epoch = 1",
        "signals.pre_transfer_reputation_excluded = true",
        "effective_history_days = 11",
        "pre-transfer feedback (40 entries) not counted in any context feedback_count",
      ],
    },
    "custody-migration": {
      snapshot: "custody-migration.json", golden: null,
      covers: "SPEC 11.6 known limitation: benign migration preserved",
      invariants: [
        "ownership_epoch = 0",
        "signals.custody_migration_detected = true",
        "all 43 feedback entries eligible",
      ],
    },
    "strong-diverse": {
      snapshot: "strong-diverse.json", golden: null,
      covers: "SPEC 11.5: strong tier with aged, diverse, corroborated evidence",
      invariants: [
        "coverage_tier = strong",
        "n_eff >= 25",
        "narrow interval relative to thin-same-day-cohort",
        "lifecycle_state = live",
      ],
    },
    "common-funder-ring": {
      snapshot: "common-funder-ring.json", golden: null,
      covers: "SPEC 11.2: shared first funder dilutes continuously",
      invariants: [
        "signals.common_funder_share = 1.0000",
        "n_eff far below 20",
        "no reviewer weight is 0 (floor 0.01)",
      ],
    },
    "bulk-reviewer": {
      snapshot: "bulk-reviewer.json", golden: null,
      covers: "UC-3, SPEC 11.2: velocity down-weight without disqualification",
      invariants: [
        "bulk wallet weight < every ordinary reviewer weight",
        "bulk wallet weight >= 0.01",
      ],
    },
    "unparseable-scale": {
      snapshot: "unparseable-scale.json", golden: null,
      covers: "SPEC 11.10: uninferable scale excluded, counted as unusable",
      invariants: [
        "score null",
        "suppression_reason references no usable feedback",
        "signals.unusable_feedback_count = 3",
      ],
    },
    "dormant": {
      snapshot: "dormant.json", golden: null,
      covers: "SPEC 11.7: previously live, inactive 180+ days",
      invariants: [
        "lifecycle_state = dormant",
        "score present (evidence decayed, not erased)",
      ],
    },
    "heavy-decay-flood": {
      snapshot: "heavy-decay-flood.json", golden: null,
      covers: "SPEC 11.4/11.1: anti-flooding cap must not negate time decay",
      invariants: [
        "the 40-review stale reviewer's capped contribution stays well below 1.0",
        "the single recent reviewer contributes more n_eff than the 40 stale reviews combined",
      ],
    },
  },
};

// Golden outputs live at fixtures/golden/<case>.json once the scoring
// engine emits them; the filenames are fixed by convention.
for (const c of Object.values(manifest.cases)) {
  c.golden = c.snapshot;
}

for (const [name, snap] of Object.entries(fixtures)) {
  writeFileSync(join(OUT, `${name}.json`), JSON.stringify(snap, null, 2) + "\n");
}
writeFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "manifest.json"),
  JSON.stringify(manifest, null, 2) + "\n",
);
console.log(`wrote ${Object.keys(fixtures).length} snapshots + manifest`);
