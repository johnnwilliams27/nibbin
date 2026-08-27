/**
 * Drizzle schema for the canonical store (SPEC section 9). Columns beyond the
 * SPEC 9 table list are documented additions; the rationale for each lives in
 * docs/NOTES-track-a.md. Anything that must not pass through JS floats is a
 * Postgres numeric or text column read back as a string.
 *
 * Naming: table and column names match SPEC 9 exactly where SPEC 9 names them.
 */
import {
  bigint,
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  serial,
  smallint,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

/** Timestamps are stored at second precision in UTC; the wire form is ISO-8601 with a trailing Z. */
const ts = (name: string) => timestamp(name, { withTimezone: true, precision: 0, mode: "date" });

/** uint256 token ids and int128 raw values never fit a JS number; numeric keeps them exact and reads back as a string. */
const uint256 = (name: string) => numeric(name, { precision: 78, scale: 0 });
const int128 = (name: string) => numeric(name, { precision: 39, scale: 0 });

export const chains = pgTable("chains", {
  chain_id: integer("chain_id").primaryKey(),
  /** Lowercase canonical name used in URLs and dumps (SPEC 24A); addition to the SPEC 9 column list. */
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  rpc_url_env_key: text("rpc_url_env_key").notNull(),
  identity_registry: text("identity_registry").notNull(),
  reputation_registry: text("reputation_registry").notNull(),
  validation_registry: text("validation_registry"),
  first_block: bigint("first_block", { mode: "number" }).notNull(),
  enabled: boolean("enabled").notNull().default(false),
});

export const agents = pgTable(
  "agents",
  {
    chain_id: integer("chain_id").notNull(),
    agent_id: uint256("agent_id").notNull(),
    owner_address: text("owner_address").notNull(),
    agent_wallet: text("agent_wallet"),
    token_uri: text("token_uri"),
    registered_block: bigint("registered_block", { mode: "number" }).notNull(),
    registered_at: ts("registered_at").notNull(),
    last_seen_block: bigint("last_seen_block", { mode: "number" }).notNull(),
    metadata_cid: text("metadata_cid"),
    metadata_resolved_at: ts("metadata_resolved_at"),
    /** resolved | unreachable | malformed | absent (SPEC 10.2). */
    metadata_status: text("metadata_status").notNull().default("absent"),
    name: text("name"),
    description: text("description"),
    services_json: jsonb("services_json"),
    supported_trust_json: jsonb("supported_trust_json"),
    x402_support: boolean("x402_support"),
    active_flag: boolean("active_flag"),
    /** placeholder | registered | live | dormant (SPEC 11.7). */
    lifecycle_state: text("lifecycle_state").notNull().default("placeholder"),
    /** Addition: agent wallet has at least one outbound transaction (SPEC 11.7 input). */
    agent_wallet_active: boolean("agent_wallet_active").notNull().default(false),
  },
  (t) => [primaryKey({ columns: [t.chain_id, t.agent_id] })],
);

export const agent_transfers = pgTable(
  "agent_transfers",
  {
    chain_id: integer("chain_id").notNull(),
    agent_id: uint256("agent_id").notNull(),
    from_address: text("from_address").notNull(),
    to_address: text("to_address").notNull(),
    block: bigint("block", { mode: "number" }).notNull(),
    ts: ts("ts").notNull(),
    tx_hash: text("tx_hash").notNull(),
    /** Addition: stable identity for idempotent upserts; SPEC 9 declares no key. */
    log_index: integer("log_index").notNull(),
    /** Additions: custody migration evidence (SPEC 11.6), null until the enrichment pass computes them. */
    same_funder: boolean("same_funder"),
    bidirectional_history: boolean("bidirectional_history"),
  },
  (t) => [
    primaryKey({ columns: [t.chain_id, t.tx_hash, t.log_index] }),
    index("agent_transfers_chain_agent_idx").on(t.chain_id, t.agent_id),
  ],
);

export const feedback = pgTable(
  "feedback",
  {
    chain_id: integer("chain_id").notNull(),
    agent_id: uint256("agent_id").notNull(),
    client_address: text("client_address").notNull(),
    feedback_index: integer("feedback_index").notNull(),
    /** Raw int128 value; exact, read back as a string. */
    value_raw: int128("value_raw").notNull(),
    value_decimals: smallint("value_decimals").notNull(),
    /** Normalized to [0,1] at PRECISION.value places; null until normalization runs or when the scale is uninferable. */
    value_normalized: numeric("value_normalized", { precision: 7, scale: 6 }),
    tag1: text("tag1").notNull().default(""),
    tag2: text("tag2").notNull().default(""),
    endpoint: text("endpoint").notNull().default(""),
    feedback_uri: text("feedback_uri").notNull().default(""),
    feedback_hash: text("feedback_hash").notNull().default(""),
    block: bigint("block", { mode: "number" }).notNull(),
    ts: ts("ts").notNull(),
    tx_hash: text("tx_hash").notNull(),
    is_revoked: boolean("is_revoked").notNull().default(false),
    revoked_block: bigint("revoked_block", { mode: "number" }),
  },
  (t) => [
    primaryKey({ columns: [t.chain_id, t.agent_id, t.client_address, t.feedback_index] }),
    index("feedback_client_address_idx").on(t.client_address),
    index("feedback_chain_agent_idx").on(t.chain_id, t.agent_id),
  ],
);

export const feedback_responses = pgTable(
  "feedback_responses",
  {
    chain_id: integer("chain_id").notNull(),
    agent_id: uint256("agent_id").notNull(),
    client_address: text("client_address").notNull(),
    feedback_index: integer("feedback_index").notNull(),
    responder: text("responder").notNull(),
    response_uri: text("response_uri").notNull().default(""),
    response_hash: text("response_hash").notNull().default(""),
    block: bigint("block", { mode: "number" }).notNull(),
    ts: ts("ts").notNull(),
  },
  (t) => [
    primaryKey({
      columns: [t.chain_id, t.agent_id, t.client_address, t.feedback_index, t.responder, t.block],
    }),
  ],
);

export const validations = pgTable(
  "validations",
  {
    chain_id: integer("chain_id").notNull(),
    request_hash: text("request_hash").notNull(),
    validator_address: text("validator_address").notNull(),
    agent_id: uint256("agent_id").notNull(),
    /** Raw response value; the Validation Registry schema is unstable (SPEC 8), treat as opaque. */
    response: integer("response").notNull(),
    response_uri: text("response_uri").notNull().default(""),
    response_hash: text("response_hash").notNull().default(""),
    tag: text("tag").notNull().default(""),
    last_update_block: bigint("last_update_block", { mode: "number" }).notNull(),
    /** Addition: ValidationRecord in @trust-index/types carries a timestamp. */
    ts: ts("ts").notNull(),
  },
  (t) => [primaryKey({ columns: [t.chain_id, t.request_hash] })],
);

export const reviewer_wallets = pgTable(
  "reviewer_wallets",
  {
    chain_id: integer("chain_id").notNull(),
    address: text("address").notNull(),
    first_seen_block: bigint("first_seen_block", { mode: "number" }),
    first_seen_ts: ts("first_seen_ts"),
    /** outbound_tx | inbound_transfer | contract_creation (SPEC 10.4). */
    first_seen_source: text("first_seen_source"),
    total_reviews: integer("total_reviews").notNull().default(0),
    distinct_agents_reviewed: integer("distinct_agents_reviewed").notNull().default(0),
    max_reviews_single_day: integer("max_reviews_single_day").notNull().default(0),
    repeat_review_rate: numeric("repeat_review_rate", { precision: 5, scale: 4 }),
    funder_address: text("funder_address"),
    funder_cluster_id: text("funder_cluster_id"),
    score_variance: numeric("score_variance", { precision: 12, scale: 6 }),
    mean_score_given: numeric("mean_score_given", { precision: 7, scale: 6 }),
    /** Addition: share of this reviewer's reviewed agents under its largest funder cluster, [0,1] at PRECISION.signal places. */
    portfolio_top_funder_share: numeric("portfolio_top_funder_share", { precision: 5, scale: 4 }),
    last_computed_at: ts("last_computed_at"),
  },
  (t) => [
    primaryKey({ columns: [t.chain_id, t.address] }),
    index("reviewer_wallets_address_idx").on(t.address),
  ],
);

export const scores = pgTable(
  "scores",
  {
    chain_id: integer("chain_id").notNull(),
    agent_id: uint256("agent_id").notNull(),
    methodology_version: text("methodology_version").notNull(),
    computed_at: ts("computed_at").notNull(),
    /** NULL is a valid, meaningful output (suppression). Display scale 0-100 at PRECISION.score places. */
    score: numeric("score", { precision: 5, scale: 2 }),
    suppression_reason: text("suppression_reason"),
    /** none | thin | moderate | strong. */
    coverage_tier: text("coverage_tier").notNull(),
    /** Every input, for reproduction (SPEC 9). */
    signals_json: jsonb("signals_json").notNull(),
    /** Additions: SPEC 11.11 outputs the anchor leaf needs without re-deriving. */
    score_low: numeric("score_low", { precision: 5, scale: 2 }),
    score_high: numeric("score_high", { precision: 5, scale: 2 }),
    confidence: numeric("confidence", { precision: 5, scale: 4 }).notNull(),
    n_eff: numeric("n_eff", { precision: 12, scale: 2 }).notNull(),
    lifecycle_state: text("lifecycle_state").notNull(),
    inputs_hash: text("inputs_hash").notNull(),
    /** Full canonical ScoreResult as served. */
    result_json: jsonb("result_json").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.chain_id, t.agent_id, t.methodology_version, t.computed_at] }),
    index("scores_chain_agent_computed_idx").on(t.chain_id, t.agent_id, t.computed_at.desc()),
  ],
);

export const index_cursors = pgTable(
  "index_cursors",
  {
    chain_id: integer("chain_id").notNull(),
    contract: text("contract").notNull(),
    last_processed_block: bigint("last_processed_block", { mode: "number" }).notNull(),
    /** Addition: block hash at last_processed_block, for parent-hash reorg detection (SPEC 10.5). */
    last_processed_hash: text("last_processed_hash"),
    updated_at: ts("updated_at").notNull(),
  },
  (t) => [primaryKey({ columns: [t.chain_id, t.contract] })],
);

/**
 * Manual score overrides (SPEC 23 incident response, SPEC 24 admin surface).
 * Suppression is always safe; every override is a row with an author, a
 * timestamp, and a written reason, and the reason is published.
 */
export const score_overrides = pgTable(
  "score_overrides",
  {
    id: serial("id").primaryKey(),
    chain_id: integer("chain_id").notNull(),
    agent_id: uint256("agent_id").notNull(),
    /** True while the override suppresses the agent's score. */
    suppress: boolean("suppress").notNull().default(true),
    author: text("author").notNull(),
    reason: text("reason").notNull(),
    created_at: ts("created_at").notNull(),
    lifted_at: ts("lifted_at"),
    lifted_by: text("lifted_by"),
    lift_reason: text("lift_reason"),
  },
  (t) => [index("score_overrides_chain_agent_idx").on(t.chain_id, t.agent_id)],
);

/**
 * Cohort priors (SPEC 11.0), computed from high-weight evidence only by the
 * prior computation job. context '' is the global prior; other rows are per
 * tag1 context. New table; SPEC 9 has no home for priors.
 */
export const priors = pgTable(
  "priors",
  {
    chain_id: integer("chain_id").notNull(),
    methodology_version: text("methodology_version").notNull(),
    /** '' means the global prior; otherwise the tag1 context. */
    context: text("context").notNull().default(""),
    /** [0,1] at PRECISION.value places. */
    value: numeric("value", { precision: 7, scale: 6 }).notNull(),
    /** high_weight_weighted_mean | commerce_corroborated. */
    basis: text("basis").notNull(),
    n_basis: numeric("n_basis", { precision: 12, scale: 2 }).notNull(),
    computed_at: ts("computed_at").notNull(),
  },
  (t) => [primaryKey({ columns: [t.chain_id, t.methodology_version, t.context] })],
);

/**
 * Detected feedback scales per (client, tag1) pair (SPEC 11.10). Index-wide
 * aggregate materialized by an enrichment pass; a missing row means the scale
 * is uninferable and the feedback is excluded from scoring as unusable.
 */
export const detected_scales = pgTable(
  "detected_scales",
  {
    chain_id: integer("chain_id").notNull(),
    client_address: text("client_address").notNull(),
    tag1: text("tag1").notNull().default(""),
    min_raw: int128("min_raw").notNull(),
    max_raw: int128("max_raw").notNull(),
    computed_at: ts("computed_at").notNull(),
  },
  (t) => [primaryKey({ columns: [t.chain_id, t.client_address, t.tag1] })],
);

/**
 * Commerce corroboration between a reviewer and an agent (SPEC 11.2): the
 * reviewer has at least one non-feedback on-chain transaction with the
 * agent's wallet. Written by the A4/A6 enrichment passes; broader than
 * commerce_events, which only covers ingested job outcomes.
 */
export const reviewer_agent_commerce = pgTable(
  "reviewer_agent_commerce",
  {
    chain_id: integer("chain_id").notNull(),
    address: text("address").notNull(),
    agent_id: uint256("agent_id").notNull(),
    /** Where the evidence came from: wallet_transfer | commerce_ingest. */
    evidence_source: text("evidence_source").notNull(),
    first_block: bigint("first_block", { mode: "number" }).notNull(),
    tx_hash: text("tx_hash"),
  },
  (t) => [
    primaryKey({ columns: [t.chain_id, t.address, t.agent_id] }),
    index("reviewer_agent_commerce_agent_idx").on(t.chain_id, t.agent_id),
  ],
);

/**
 * Commerce interactions (A6 ingest target: Olas, Virtuals ACP). Feeds
 * AgentSnapshot.commerce and reviewer commerce corroboration.
 */
export const commerce_events = pgTable(
  "commerce_events",
  {
    id: serial("id").primaryKey(),
    chain_id: integer("chain_id").notNull(),
    agent_id: uint256("agent_id").notNull(),
    counterparty: text("counterparty").notNull(),
    /** completed | rejected | disputed | abandoned. */
    outcome: text("outcome").notNull(),
    block: bigint("block", { mode: "number" }).notNull(),
    ts: ts("ts").notNull(),
    /** olas | virtuals_acp. */
    source: text("source").notNull(),
    tx_hash: text("tx_hash"),
  },
  (t) => [index("commerce_events_chain_agent_idx").on(t.chain_id, t.agent_id)],
);
