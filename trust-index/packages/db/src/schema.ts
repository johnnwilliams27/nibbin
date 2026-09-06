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
  uniqueIndex,
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
    /**
     * The platform's own job identifier. Unique per source, so re-running an
     * ingest over a block range upserts rather than duplicating: a duplicated
     * outcome row would silently reweight the calibration label set.
     */
    job_id: text("job_id").notNull(),
    /** agent_wallet | owner_address | historical_owner (A6 linkage). */
    linkage_method: text("linkage_method").notNull(),
    /**
     * strong | moderate. Retained so a calibration cohort can be filtered or
     * weighted by how confidently each outcome was attributed to its agent.
     */
    linkage_strength: text("linkage_strength").notNull(),
  },
  (t) => [
    index("commerce_events_chain_agent_idx").on(t.chain_id, t.agent_id),
    uniqueIndex("commerce_events_source_job_idx").on(t.source, t.job_id),
  ],
);

/* -------------------------------------------------------------------------
 * The generic rating contract (METHODOLOGY.md, @trust-index/types rating.ts).
 *
 * Everything above this line is ERC-8004: an agent is a token id on a chain,
 * and evidence is a feedback event. Everything below it is subject-agnostic —
 * an MCP server, a hosted agent, a package — and shares nothing with the chain
 * tables but the conventions (exact numerics as Postgres numeric, second
 * precision UTC timestamps, additions documented where they are not in the
 * type).
 *
 * The keying rule for the whole block: a subject is addressed by
 * (kind, source_registry, subject_id). Subject.subject_id is documented as
 * "unique only in combination with `source`", so the registry is part of the
 * key rather than an attribute; two registries listing the same name are two
 * subjects until someone proves otherwise, which is the safe direction.
 * ---------------------------------------------------------------------- */

/** Normalized [0,1] evidence values and observer concentration, at PRECISION.value. */
const unitValue = (name: string) => numeric(name, { precision: 7, scale: 6 });
/** 0-100 display scale at PRECISION.score, matching `scores`. */
const displayScore = (name: string) => numeric(name, { precision: 5, scale: 2 });
/** Shares and confidences in [0,1] at PRECISION.signal / PRECISION.confidence. */
const unitShare = (name: string) => numeric(name, { precision: 5, scale: 4 });

/**
 * A rated thing. One row per subject; the row is current state and is
 * overwritten as the subject is re-observed.
 *
 * That is safe HERE and is not safe for observations, and the difference is
 * the whole reason the two tables are shaped differently. Nothing on this row
 * is evidence: it is identity, the profile the subject is currently assessed
 * under, and the frame a rebuild needs. The evidence lives in `observations`,
 * which never overwrites. The exact frame that produced any one published
 * result lives in that result's `inputs_json`, so re-pointing a subject at a
 * new profile tomorrow cannot retroactively change what yesterday's rating was
 * computed from.
 */
export const subjects = pgTable(
  "subjects",
  {
    /** SubjectKind: "mcp_server", "agent", "package". Open by design. */
    kind: text("kind").notNull(),
    /** Subject.source.registry — the namespace subject_id is unique within. */
    source_registry: text("source_registry").notNull(),
    subject_id: text("subject_id").notNull(),

    /** Subject.source.ref: the native reference inside that registry. */
    source_ref: text("source_ref").notNull(),
    /** Subject.source.url: canonical human-facing URL, null when the registry offers none. */
    source_url: text("source_url"),

    /** Profile currently in force. Every stored result names its own; this is only the default for the next run. */
    profile_id: text("profile_id").notNull(),
    /** Collector rubric currently in force, same caveat as profile_id. */
    rubric_version: text("rubric_version").notNull(),

    first_seen_ts: ts("first_seen_ts").notNull(),
    /** Null means never observed operational, which is not the same as "observed down". */
    last_active_ts: ts("last_active_ts"),
    reachable: boolean("reachable").notNull(),

    /** Subject.tags, a JSON array of strings. Never scored; excluded from inputs_hash by the engine. */
    tags: jsonb("tags").notNull().default([]),
    /** Subject.independence_group: the subject's own cluster, used only for cohort priors. */
    independence_group: text("independence_group"),

    /**
     * Priors and constants as of the last assembly. Additions to the type's
     * field list in the sense that they are stored per subject rather than per
     * observation, and they are here because a Subject cannot be rebuilt from
     * rows without them: the estimator reads both.
     */
    priors_json: jsonb("priors_json").notNull(),
    constants_json: jsonb("constants_json").notNull(),

    /** Subject.as_of_ts of the most recent assembly. */
    as_of_ts: ts("as_of_ts").notNull(),
    updated_at: ts("updated_at").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.kind, t.source_registry, t.subject_id] }),
    index("subjects_kind_idx").on(t.kind),
    index("subjects_independence_group_idx").on(t.independence_group),
  ],
);

/**
 * Who produced observations. Current state, one row per observer id.
 *
 * Overwriting is correct here for the same reason it is wrong for
 * observations: an observer's volume counters ("how many observations has this
 * harness produced, across how many subjects") are a running total, not a
 * measurement of anything at a moment. The values that fed a particular score
 * are inside that result's frame_json, so history is not lost by keeping this
 * table current.
 */
export const observers = pgTable("observers", {
  observer_id: text("observer_id").primaryKey(),
  /** probe | reviewer | attester | publisher. */
  observer_kind: text("observer_kind").notNull(),
  first_seen_ts: ts("first_seen_ts").notNull(),
  total_observations: integer("total_observations").notNull(),
  distinct_subjects: integer("distinct_subjects").notNull(),
  max_observations_single_day: integer("max_observations_single_day").notNull(),
  /** Funding cluster, owning organization, shared publisher. Null is "no group established", not "independent". */
  independence_group: text("independence_group"),
  concentration: unitValue("concentration").notNull(),
  updated_at: ts("updated_at").notNull(),
});

/**
 * The one Observer field that is not a property of the observer.
 *
 * `Observer.has_interaction_with_subject` is declared on Observer but is a
 * statement about a PAIR — this observer has a paid job with THAT subject —
 * and it up-weights the observation by interaction_multiplier, so it has to be
 * stored per pair or the rebuild is wrong. Splitting it out is a decision the
 * methodology does not make; recorded in docs/NOTES-track-a.md.
 */
export const subject_observers = pgTable(
  "subject_observers",
  {
    kind: text("kind").notNull(),
    source_registry: text("source_registry").notNull(),
    subject_id: text("subject_id").notNull(),
    observer_id: text("observer_id").notNull(),
    has_interaction_with_subject: boolean("has_interaction_with_subject").notNull().default(false),
    first_observed_ts: ts("first_observed_ts").notNull(),
    last_observed_ts: ts("last_observed_ts").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.kind, t.source_registry, t.subject_id, t.observer_id] }),
    index("subject_observers_observer_idx").on(t.observer_id),
  ],
);

/**
 * Evidence. Append-only in practice: a row is upserted on its own identity and
 * nothing ever deletes or supersedes yesterday's.
 *
 * The primary key is exactly the engine's dedupe key
 * (observationKey() in packages/scoring/src/rating/hash.ts):
 * observer + dimension + observation_key + ts. That equality is the point, and
 * it is what makes the two non-negotiable properties hold at once.
 *
 *  - Re-running today's collection twice writes the same rows twice and
 *    changes nothing, because the identity of an observation is the check at a
 *    moment.
 *  - Tomorrow's run of the SAME check writes a new row, because `ts` differs.
 *    `availability` and `functional_correctness` resample
 *    `independent_per_day`, and the confidence model can only see N distinct
 *    days of evidence if N distinct days of rows survive. A table keyed
 *    (subject, check) with an ON CONFLICT UPDATE would silently hold n_eff at
 *    one day forever while every interval kept reporting as though it had
 *    watched for months.
 *
 * The engine applies the `latest_only` policy at score time, so a static check
 * re-read daily accumulates rows here and still contributes once. Storing the
 * history for a `latest_only` dimension costs a row a day and buys the ability
 * to answer "when did this server's tool list change", which discarding it
 * does not.
 */
export const observations = pgTable(
  "observations",
  {
    kind: text("kind").notNull(),
    source_registry: text("source_registry").notNull(),
    subject_id: text("subject_id").notNull(),
    observer_id: text("observer_id").notNull(),
    dimension: text("dimension").notNull(),
    /** Names the CHECK, with the engine's instance suffix ("availability:1"). Gates match on the part before the colon. */
    observation_key: text("observation_key").notNull(),
    ts: ts("ts").notNull(),

    /** measured | attested | judged | third_party_review | self_reported. */
    provenance: text("provenance").notNull(),
    /** Normalized to [0,1] by the collector, 1 is the good end. */
    value: unitValue("value").notNull(),
    /** Audit pointer, never scored, deliberately excluded from inputs_hash. */
    evidence_ref: text("evidence_ref"),

    /**
     * Addition: which collection run wrote this row. Not part of the
     * observation's identity — two runs producing the same check at the same
     * instant are one observation — but it is how a bad run is traced and, if
     * it comes to it, retracted.
     */
    run_id: text("run_id"),
  },
  (t) => [
    primaryKey({
      columns: [t.kind, t.source_registry, t.subject_id, t.observer_id, t.dimension, t.observation_key, t.ts],
    }),
    index("observations_subject_ts_idx").on(t.kind, t.source_registry, t.subject_id, t.ts.desc()),
    index("observations_subject_dimension_idx").on(t.kind, t.source_registry, t.subject_id, t.dimension),
    index("observations_run_idx").on(t.run_id),
  ],
);

/**
 * Checks that did not run, and whose fault that was.
 *
 * A gap is a statement about OUR run, not about the subject — which is why the
 * engine excludes gaps from inputs_hash, and why this table is keyed by the
 * run's as_of_ts rather than upserted per (subject, check). Overwriting would
 * make "we have never held a credential for this" and "we held one yesterday
 * and it expired this morning" the same row, and those are different facts
 * about us with different fixes.
 *
 * AssessmentGap carries no timestamp of its own, so as_of_ts is the as_of_ts
 * of the assembly that recorded it. An addition, noted in the report.
 */
export const assessment_gaps = pgTable(
  "assessment_gaps",
  {
    kind: text("kind").notNull(),
    source_registry: text("source_registry").notNull(),
    subject_id: text("subject_id").notNull(),
    /** The Subject.as_of_ts of the assembly that recorded this gap. */
    as_of_ts: ts("as_of_ts").notNull(),
    dimension: text("dimension").notNull(),
    /** The check that did not run, matching the observation_key it would have produced. */
    check: text("check").notNull(),

    /** harness_capability_missing | harness_capability_unhealthy | subject_blocked | not_applicable. */
    cause: text("cause").notNull(),
    /** Capability the check needed, for harness causes. Null otherwise. */
    capability: text("capability"),
    detail: text("detail").notNull(),
    run_id: text("run_id"),
  },
  (t) => [
    primaryKey({
      columns: [t.kind, t.source_registry, t.subject_id, t.as_of_ts, t.dimension, t.check],
    }),
    index("assessment_gaps_subject_idx").on(t.kind, t.source_registry, t.subject_id, t.as_of_ts.desc()),
    // The harness work queue: every subject blocked on a capability we do not
    // hold or cannot keep healthy, which is the list that gets fixed first.
    index("assessment_gaps_cause_capability_idx").on(t.cause, t.capability),
  ],
);

/**
 * One rating: a subject, a profile, one UTC day, published or withheld.
 *
 * A DAILY SNAPSHOT, AND ONLY THAT. One row per subject per profile per day,
 * written by the daily job, retained for 30 days. There are deliberately no
 * 7-day or 30-day rows and no aggregate columns: the history is the series of
 * daily rows, and how to average them is an open question the owner has
 * parked. Storing a rolling mean now would answer it by accident and in the
 * worst possible place — a stored column nobody can recompute or revise.
 *
 * WHEN AVERAGING ARRIVES it reads this series, and this table keeps enough per
 * day to let it be done properly rather than badly. That means a day carries
 * its own coverage, completeness, observation and observed-day counts, its
 * digests, and its frame — not just a number. Two rules the future averaging
 * has to obey, recorded here because this is where the temptation will be:
 *
 *   A MULTI-DAY SCORE IS `scoreSubject` RE-RUN OVER THE DAYS' OBSERVATIONS,
 *   never a mean of `composite`. The estimator already shrinks sparse evidence
 *   toward the cohort prior; averaging its outputs shrinks a second time and
 *   produces a number that is not an estimate of anything.
 *
 *   ONLY DAYS SHARING ALL THREE DIGESTS ARE COMPARABLE. A day scored under one
 *   rubric and a day scored under another do not belong on the same line.
 *
 * DAYS ARE UTC DAYS, as YYYY-MM-DD, matching `collection_runs.utc_day`. Not a
 * timestamp: the volume cap is keyed on observer plus UTC day and
 * `independent_per_day` resampling counts distinct UTC days, so a boundary that
 * drifted off midnight would disagree with the estimator about how many
 * independent samples a day holds — quietly, and in the direction of more
 * confidence than the evidence supports.
 *
 * NULL composite is a first-class outcome and not a missing value. THREE
 * states have to stay distinguishable downstream and this table keeps them
 * apart:
 *   - we did not run          — no row, and `collection_runs` has no
 *                               succeeded row for that day either
 *   - we ran and withheld     — a row with NULL composite, a suppression
 *                               reason, and observation_count possibly 0
 *   - we ran and it scored    — a row with a composite
 * A single day is often `thin` and therefore withheld; that is correct
 * behaviour and is stored, not skipped. A sparkline with a hole in it must be
 * able to say which of the three the hole is, so a consumer never draws a
 * withheld day and an un-run day the same way.
 */
export const rating_results = pgTable(
  "rating_results",
  {
    kind: text("kind").notNull(),
    source_registry: text("source_registry").notNull(),
    subject_id: text("subject_id").notNull(),
    /** Profile the result was computed under. Part of the key: two profiles are two ratings, not two versions of one. */
    profile_id: text("profile_id").notNull(),
    /** The UTC day this snapshot covers, YYYY-MM-DD. With the subject and profile it identifies the row. */
    utc_day: text("utc_day").notNull(),

    /**
     * as_of_ts handed to the engine, which is the run's clock reading and not
     * the day boundary: you cannot score as of a boundary that has not
     * happened yet. Observation decay and lifecycle are measured from here.
     */
    computed_at: ts("computed_at").notNull(),
    rating_methodology_version: text("rating_methodology_version").notNull(),

    /** NULL when withheld. Never 0 — "we did not assess this" and "this scored badly" are different answers. */
    composite: displayScore("composite"),
    composite_low: displayScore("composite_low"),
    composite_high: displayScore("composite_high"),
    composite_confidence: unitShare("composite_confidence").notNull(),
    /** Share of the profile's weight that produced a published dimension. */
    dimension_coverage: unitShare("dimension_coverage").notNull(),
    /** Share of the profile's weight we were ABLE to attempt. Read together with coverage, per SubjectScoreResult. */
    assessment_completeness: unitShare("assessment_completeness").notNull(),
    composite_suppression_reason: text("composite_suppression_reason"),

    /** declared | reachable | live | dormant. */
    lifecycle: text("lifecycle").notNull(),

    /**
     * Observations on this day, before the engine dropped any for provenance
     * or resampling. Zero is a real, stored value: it separates "this day
     * contains no evidence" from "this day was never written".
     */
    observation_count: integer("observation_count").notNull().default(0),

    /**
     * Composite coverage tier: none | thin | moderate | strong.
     *
     * DERIVED AT STORE TIME, and this is the one place the methodology does not
     * hand us the answer. It states that every published rating carries a
     * coverage tier, but SubjectScoreResult computes a tier per DIMENSION and
     * none for the composite, and changing the engine to emit one is out of
     * scope here. `coverage_tier_basis` names the rule that produced this value
     * so it can be superseded without ambiguity once the methodology decides.
     */
    coverage_tier: text("coverage_tier").notNull(),
    /** Rule that derived coverage_tier, e.g. "min_published_dimension". */
    coverage_tier_basis: text("coverage_tier_basis").notNull(),

    /**
     * The three digests, on every row. A day scored under one rubric and a day
     * scored under another are not comparable and must not be plotted on the
     * same line; without the digests on the row itself there is nothing to
     * compare, and the 30-day series would silently mix them.
     *   profile_digest  — dimensions, weights, gates
     *   inputs_hash     — the observations that entered THIS day
     *   rubric_version  — the collector code that made those observations
     * The third exists because retuning one normalisation curve moved every
     * maintenance score in the compendium while neither of the other two moved.
     */
    profile_digest: text("profile_digest").notNull(),
    inputs_hash: text("inputs_hash").notNull(),
    rubric_version: text("rubric_version").notNull(),

    /**
     * The Subject as scored, MINUS its observations: identity, profile, priors,
     * constants, observers, gaps.
     *
     * The observations are deliberately not duplicated here. They are already
     * in `observations`, keyed by the engine's own dedupe key, and `utc_day` on
     * this row selects exactly the ones that entered it — so a reproducer
     * rebuilds the Subject from this frame plus that day and checks the result
     * against `inputs_hash`. Storing them a second time per day would make the
     * normalized table decorative. Everything that is NOT reconstructible from
     * the observation rows — the observer counters, the priors and the
     * constants as they stood — is here, because those are current-state
     * elsewhere and would otherwise reproduce as today's values.
     */
    frame_json: jsonb("frame_json").notNull(),
    /** Full canonical SubjectScoreResult as served, including gates_fired and harness_gaps. */
    result_json: jsonb("result_json").notNull(),

    run_id: text("run_id"),
  },
  (t) => [
    primaryKey({
      columns: [t.kind, t.source_registry, t.subject_id, t.profile_id, t.utc_day],
    }),
    // The 30 days behind one subject's sparkline, newest first.
    index("rating_results_series_idx").on(
      t.kind,
      t.source_registry,
      t.subject_id,
      t.utc_day.desc(),
    ),
    // Listing: the compendium page asks for one day across a kind, newest first.
    index("rating_results_kind_day_idx").on(t.kind, t.utc_day.desc()),
    // Retention: "delete every row older than 30 days" scans this and nothing else.
    index("rating_results_day_idx").on(t.utc_day),
    index("rating_results_inputs_hash_idx").on(t.inputs_hash),
  ],
);

/**
 * Per-dimension scores of one result, promoted out of result_json.
 *
 * result_json already contains these verbatim; this table exists so the
 * questions the product actually asks are queries rather than scans: which
 * subjects publish an injection_resistance score, what does the population look
 * like on one dimension over the last 30 days, which dimension is most often
 * withheld and why.
 */
export const rating_dimension_scores = pgTable(
  "rating_dimension_scores",
  {
    kind: text("kind").notNull(),
    source_registry: text("source_registry").notNull(),
    subject_id: text("subject_id").notNull(),
    profile_id: text("profile_id").notNull(),
    utc_day: text("utc_day").notNull(),
    dimension: text("dimension").notNull(),

    /** NULL when this dimension is withheld; the reason is beside it. */
    score: displayScore("score"),
    score_low: displayScore("score_low"),
    score_high: displayScore("score_high"),
    confidence: unitShare("confidence").notNull(),
    n_eff: numeric("n_eff", { precision: 12, scale: 2 }).notNull(),
    /** none | thin | moderate | strong, as the engine computed it for this dimension. */
    coverage_tier: text("coverage_tier").notNull(),
    observation_count: integer("observation_count").notNull(),
    rejected_provenance_count: integer("rejected_provenance_count").notNull(),
    self_reported_share: unitShare("self_reported_share").notNull(),
    self_reported_capped: boolean("self_reported_capped").notNull(),
    distinct_observers: integer("distinct_observers").notNull(),
    span_days: integer("span_days").notNull(),
    suppression_reason: text("suppression_reason"),
    /** Gate id that capped this dimension, or null. */
    gate_capped_by: text("gate_capped_by"),
  },
  (t) => [
    primaryKey({
      columns: [
        t.kind,
        t.source_registry,
        t.subject_id,
        t.profile_id,
        t.utc_day,
        t.dimension,
      ],
    }),
    index("rating_dimension_scores_dimension_idx").on(t.dimension, t.utc_day.desc()),
    // Retention deletes these alongside their parent rows.
    index("rating_dimension_scores_day_idx").on(t.utc_day),
  ],
);

/**
 * What the scheduled collector did, each time it ran.
 *
 * Deliberately a ledger and not a job queue. The smallest thing that answers
 * "did collection run last night, and what happened" is one row per run with a
 * status and counts; anything more is a distributed job system nobody asked
 * for. A run that dies leaves a `running` row with no finished_at, which is
 * itself the alert.
 */
export const collection_runs = pgTable(
  "collection_runs",
  {
    /** Caller-supplied, stable, and unique: the UTC day plus the collector name, so a day cannot be double-counted. */
    run_id: text("run_id").primaryKey(),
    /** Which collector: "mcp". */
    collector: text("collector").notNull(),
    /** UTC day the run belongs to, YYYY-MM-DD. Distinct from started_at, which is a clock reading. */
    utc_day: text("utc_day").notNull(),
    started_at: ts("started_at").notNull(),
    finished_at: ts("finished_at"),
    /** running | succeeded | failed. */
    status: text("status").notNull(),

    subjects_seen: integer("subjects_seen").notNull().default(0),
    observations_written: integer("observations_written").notNull().default(0),
    gaps_written: integer("gaps_written").notNull().default(0),
    /**
     * Snapshots the run published and withheld for its day. These sum to the
     * subjects it scored; `subjects_failed` counts the ones it could not score
     * at all, which is a different thing from scoring one and withholding it.
     */
    results_published: integer("results_published").notNull().default(0),
    results_withheld: integer("results_withheld").notNull().default(0),
    /** Subjects the run could not score at all, as distinct from scored-and-withheld. */
    subjects_failed: integer("subjects_failed").notNull().default(0),

    /** First line of the failure, when status is failed. Null otherwise. */
    error: text("error"),
    /** Per-stage timings and command lines, for the operator reading a slow night. */
    detail_json: jsonb("detail_json"),
  },
  (t) => [index("collection_runs_day_idx").on(t.collector, t.utc_day)],
);
