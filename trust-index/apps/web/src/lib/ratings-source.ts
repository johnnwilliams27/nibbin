/**
 * RatingsSource: the read path for the compendium.
 *
 * WHY THIS IS A SECOND INTERFACE AND NOT MORE METHODS ON `DataSource`.
 *
 * `DataSource` is not merely chain-flavoured in its vocabulary; it is chain-shaped
 * in its KEY. Every method takes `(chainSlug, agentId)`, and `chainSlug` resolves
 * to a row in `chains` carrying a chain_id, an RPC url and two registry
 * addresses. A rated subject is keyed `(kind, source_registry, subject_id)` —
 * three parts, none of which is a chain, and `subject_id` is documented as unique
 * only in combination with its registry. Passing "mcp-registry" as a `chainSlug`
 * would type-check and would be a lie; the very next reader would try to look up
 * its chain_id.
 *
 * It is also shaped by the chain's clock. `DataSource` anchors everything to a
 * block: `AgentDetail.score.as_of_block`, `getIndexedThrough(): {block, ts}`, and
 * `ApiMeta.indexed_through_block` on every envelope. A daily snapshot has no
 * block and never will. Extending the existing interface would mean making
 * `block` nullable across the chain path too, which weakens a contract that is
 * currently exact for the sake of one that never needed it.
 *
 * And the deciding reason: the three rules this product exists to enforce are
 * enforceable HERE in the type system, and are not retrofittable there. In this
 * file a withheld rating has no `composite` field at all — not a nullable one, no
 * field — so a renderer cannot print it as 0 because there is no number to reach
 * for. `dimension_coverage` and `assessment_completeness` are two required fields
 * of one required object, so serving one without the other does not compile.
 * Bolting these onto `AgentDetail` would make each of them an optional field, and
 * an optional invariant is not an invariant.
 *
 * What the two interfaces DO share is the plumbing, deliberately: the same
 * `ApiEnvelope`, the same rate limiting, the same error codes, the same
 * pagination helpers. The split is at the data contract, which is where the two
 * things genuinely differ, and nowhere else.
 *
 * DROP-IN COMPATIBILITY is a property of this file, not of its implementations.
 * Everything below is plain data with no database types in it, so
 * FixtureRatingsSource and PostgresRatingsSource return the same shapes and
 * `test/ratings-source.test.ts` runs one contract suite against both.
 */

/**
 * An exact decimal, as stored. Postgres numerics come back as strings and stay
 * strings all the way to the reader: parsing "77.17" into a float to print it
 * again would be a round trip through a representation that cannot hold it, in
 * a project whose engine is fixed-point precisely to avoid that.
 */
export type Decimal = string;

/** A rated thing. Three parts; none of them is optional and none is a chain. */
export type SubjectRef = {
  kind: string;
  source_registry: string;
  subject_id: string;
};

/**
 * The pair that must never be merged, carried as one object so it cannot be
 * split by accident.
 *
 * `dimension_coverage` is the share of the ASSESSABLE weight that published.
 * `assessment_completeness` is the share of the whole profile we were able to
 * attempt at all. They answer different questions and the difference is whose
 * fault a shortfall is:
 *
 *   coverage 0.60, completeness 1.00 — fully assessable, came up short. Theirs.
 *   coverage 1.00, completeness 0.13 — everything we could reach passed, and we
 *                                      could reach an eighth of the profile. Ours.
 *
 * On the live population the second line is the common case, not the corner
 * case: 259 of 600 subjects sit at exactly coverage 1.00 / completeness 0.13.
 * A single blended "coverage" number would publish our missing credentials as
 * their rating.
 */
export type AssessmentCoverage = {
  dimension_coverage: Decimal;
  assessment_completeness: Decimal;
};

/** The three digests that say whether two days are comparable at all. */
export type RatingDigests = {
  profile_digest: string;
  inputs_hash: string;
  rubric_version: string;
};

/**
 * A rating, published or not.
 *
 * A discriminated union and not a nullable number. `state: "withheld"` carries
 * no `composite` key of any kind, so the withheld-renders-as-zero bug is a type
 * error rather than a code review catch.
 */
export type Rating =
  | {
      state: "scored";
      composite: Decimal;
      /** Absent bounds are served absent: null means the engine published none. */
      composite_low: Decimal | null;
      composite_high: Decimal | null;
      composite_confidence: Decimal;
    }
  | {
      state: "withheld";
      /** The engine's own words. null only when it gave none. */
      suppression_reason: string | null;
      /** Confidence is computed even when the composite is not published. */
      composite_confidence: Decimal;
    };

/** One subject's stored day, as a listing row serves it. */
export type SubjectSnapshot = {
  ref: SubjectRef;
  profile_id: string;
  /** The day this snapshot covers. Present on every row so a reader can see which are stale. */
  utc_day: string;
  computed_at: string;
  rating_methodology_version: string;
  /** declared | reachable | live | dormant. */
  lifecycle: string;
  /** Observations that entered this day before the engine dropped any. 0 is a real value. */
  observation_count: number;
  coverage: AssessmentCoverage;
  /** Composite tier, with the rule that derived it — the methodology defines none. */
  coverage_tier: string;
  coverage_tier_basis: string;
  digests: RatingDigests;
  rating: Rating;
};

/** One dimension of one day. Same union discipline as the composite. */
export type DimensionResult = {
  dimension: string;
  coverage_tier: string;
  confidence: Decimal;
  n_eff: Decimal;
  observation_count: number;
  /** Observations this dimension refused for their provenance. */
  rejected_provenance_count: number;
  self_reported_share: Decimal;
  self_reported_capped: boolean;
  distinct_observers: number;
  span_days: number;
  /** Gate that capped this dimension, or null. */
  gate_capped_by: string | null;
} & (
  | { state: "scored"; score: Decimal; score_low: Decimal | null; score_high: Decimal | null }
  | { state: "withheld"; suppression_reason: string | null }
);

/** A gate that fired. Reported whether or not a composite was published. */
export type FiredGate = {
  gate_id: string;
  dimension: string;
  trigger: string;
  /** On the 0-100 display scale. */
  observed: number;
  caps_composite_at: number;
  reason: string;
};

/**
 * A check OUR harness could not run. Never evidence, never a score.
 *
 * Served on the detail of every subject that has one, because on the live data
 * this is the reason 439 of 600 ratings are withheld and the reader is entitled
 * to know that the hole is ours.
 */
export type HarnessGap = {
  dimension: string;
  check: string;
  capability: string | null;
  detail: string;
};

/** Where a subject was found, as it stood on the day that was scored. */
export type SubjectSource = {
  registry: string;
  ref: string;
  url: string | null;
};

export type SubjectDetail = SubjectSnapshot & {
  /** From the scored day's own frame, not from current state. null when the frame carried none. */
  source: SubjectSource | null;
  dimensions: DimensionResult[];
  gates_fired: FiredGate[];
  harness_gaps: HarnessGap[];
};

/**
 * One day of a subject's history. FOUR states, and the fourth is the one that
 * gets lost.
 *
 * `not_run` and `not_assessed` are different facts and a sparkline must draw
 * them differently: the first is our collector down, the second is this subject
 * not being in a run that otherwise succeeded. Neither is a zero and neither is
 * a withheld rating.
 */
export type RatingDay =
  | { utc_day: string; state: "not_run" }
  | { utc_day: string; state: "not_assessed" }
  | {
      utc_day: string;
      state: "withheld";
      suppression_reason: string | null;
      coverage: AssessmentCoverage;
      observation_count: number;
      digests: Pick<RatingDigests, "profile_digest" | "rubric_version">;
    }
  | {
      utc_day: string;
      state: "scored";
      composite: Decimal;
      composite_low: Decimal | null;
      composite_high: Decimal | null;
      composite_confidence: Decimal;
      coverage_tier: string;
      coverage: AssessmentCoverage;
      observation_count: number;
      digests: Pick<RatingDigests, "profile_digest" | "rubric_version">;
    };

export type SubjectSeries = {
  ref: SubjectRef;
  profile_id: string;
  /** Oldest first, one entry per day in the window, no gaps in the array. */
  days: RatingDay[];
  from_day: string;
  through_day: string;
};

export type SubjectListState = "all" | "scored" | "withheld";
export type SubjectListOrder = "composite_desc" | "composite_asc" | "subject_asc" | "day_desc";

export type SubjectListQuery = {
  kind: string;
  profile_id?: string;
  source_registry?: string;
  state?: SubjectListState;
  order?: SubjectListOrder;
  cursor?: string | null;
  limit?: number;
  /** Most recent day to consider. Defaults to today in UTC. */
  through_day?: string;
};

export type SubjectPage = {
  items: SubjectSnapshot[];
  next_cursor: string | null;
  /** Subjects matching the filter, not rows on this page. */
  total: number;
  /** Subjects of this kind before the state filter, so "161 of 600" is one call. */
  total_unfiltered: number;
};

/** A kind that currently has stored ratings. */
export type RatedKind = {
  kind: string;
  source_registry: string;
  profile_id: string;
  subjects: number;
  latest_day: string;
};

/**
 * Whether the collector ran, and when.
 *
 * The honest companion to the four day-states: a reader looking at a fortnight
 * of `not_run` should be able to find out that we knew.
 */
export type RatingsHealth = {
  runs: Array<{
    collector: string;
    utc_day: string;
    status: string;
    started_at: string;
    finished_at: string | null;
    subjects_seen: number;
    results_published: number;
    results_withheld: number;
    subjects_failed: number;
    error: string | null;
  }>;
  /** Latest day with at least one stored snapshot, or null when nothing is stored. */
  latest_stored_day: string | null;
};

export type SubjectDetailQuery = {
  profile_id?: string;
  through_day?: string;
};

export type SubjectSeriesQuery = SubjectDetailQuery & {
  days?: number;
  /** Which collector's ledger decides "did we run at all". */
  collector?: string;
};

export type RatingsSource = {
  /** Subjects of one kind, most recent snapshot each, filtered, ordered, paginated. */
  listSubjects(q: SubjectListQuery): Promise<SubjectPage>;
  /** One subject's latest snapshot with its dimensions, gates and harness gaps. */
  getSubject(ref: SubjectRef, q?: SubjectDetailQuery): Promise<SubjectDetail | null>;
  /** One subject's window of days, every day present, four states. */
  getSubjectSeries(ref: SubjectRef, q?: SubjectSeriesQuery): Promise<SubjectSeries | null>;
  /** What is rated at all. */
  listKinds(): Promise<RatedKind[]>;
  /** The run ledger behind the day-states. */
  getHealth(): Promise<RatingsHealth>;
};

/** Default profile when a caller names none. Matches what the collector writes. */
export const DEFAULT_PROFILE_ID = "mcp_server.v2";

/** Days of history the store retains, mirroring RETENTION_DAYS in @trust-index/db. */
export const SERIES_DAYS = 30;

/** Today in UTC as YYYY-MM-DD. The only clock read on this path. */
export function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}
