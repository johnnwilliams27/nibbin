/**
 * The Postgres-backed RatingsSource: the compendium read against the tables the
 * daily job writes.
 *
 * This is the only module in the app that talks to @trust-index/db. Everything
 * it returns is plain data declared in ratings-source.ts, so the fixture source
 * and this one are interchangeable and the contract suite runs against both.
 *
 * Three habits here are load-bearing rather than stylistic:
 *
 * 1. NUMERICS STAY STRINGS. Postgres hands back `composite` as "77.17" and it
 *    leaves here as "77.17". Nothing on this path parses a decimal into a float,
 *    because the engine is fixed-point specifically so that it never has to.
 *
 * 2. NULL COMPOSITE BECOMES A WITHHELD VARIANT, never a zero and never a
 *    dropped row. `toRating` is the single place that decision is made, and it
 *    is the reason a withheld rating reaches the reader with the engine's own
 *    suppression reason attached.
 *
 * 3. ABSENT STAYS ABSENT. A missing interval bound is null, a missing frame
 *    source is null, and nothing here substitutes a default for a value the
 *    store did not have.
 */
import {
  createDb,
  readDimensionScores,
  readLatestSnapshot,
  readLatestSnapshotPage,
  readRatedKinds,
  readRunLedger,
  readSnapshotSeries,
  type DbHandle,
  type SnapshotDay,
  type SnapshotSummary,
} from "@trust-index/db";
import { clampLimit, decodeCursor, encodeCursor } from "./pagination.js";
import {
  DEFAULT_PROFILE_ID,
  SERIES_DAYS,
  todayUtc,
  type DimensionResult,
  type FiredGate,
  type HarnessGap,
  type RatedKind,
  type Rating,
  type RatingDay,
  type RatingsHealth,
  type RatingsSource,
  type SubjectDetail,
  type SubjectDetailQuery,
  type SubjectListQuery,
  type SubjectPage,
  type SubjectRef,
  type SubjectSeries,
  type SubjectSeriesQuery,
  type SubjectSnapshot,
  type SubjectSource,
} from "./ratings-source.js";

/** Second-precision UTC, matching how the store writes timestamps. */
function iso(at: Date): string {
  return `${at.toISOString().slice(0, 19)}Z`;
}

/**
 * The one decision this module exists to get right.
 *
 * A null composite is not a low score and not a missing row: it is a rating we
 * computed and deliberately did not publish. It becomes a variant with no
 * composite field, carrying the reason, so nothing downstream can render it as
 * a number.
 */
function toRating(row: {
  composite: string | null;
  composite_low: string | null;
  composite_high: string | null;
  composite_confidence: string;
  composite_suppression_reason: string | null;
}): Rating {
  if (row.composite === null) {
    return {
      state: "withheld",
      suppression_reason: row.composite_suppression_reason,
      composite_confidence: row.composite_confidence,
    };
  }
  return {
    state: "scored",
    composite: row.composite,
    composite_low: row.composite_low,
    composite_high: row.composite_high,
    composite_confidence: row.composite_confidence,
  };
}

function toSnapshot(row: SnapshotSummary): SubjectSnapshot {
  return {
    ref: { kind: row.kind, source_registry: row.source_registry, subject_id: row.subject_id },
    profile_id: row.profile_id,
    utc_day: row.utc_day,
    computed_at: iso(row.computed_at),
    rating_methodology_version: row.rating_methodology_version,
    lifecycle: row.lifecycle,
    observation_count: row.observation_count,
    // The two numbers travel together from here to the reader. Serving one
    // without the other is not expressible in AssessmentCoverage.
    coverage: {
      dimension_coverage: row.dimension_coverage,
      assessment_completeness: row.assessment_completeness,
    },
    coverage_tier: row.coverage_tier,
    coverage_tier_basis: row.coverage_tier_basis,
    digests: {
      profile_digest: row.profile_digest,
      inputs_hash: row.inputs_hash,
      rubric_version: row.rubric_version,
    },
    rating: toRating(row),
  };
}

function toDimension(row: {
  dimension: string;
  score: string | null;
  score_low: string | null;
  score_high: string | null;
  confidence: string;
  n_eff: string;
  coverage_tier: string;
  observation_count: number;
  rejected_provenance_count: number;
  self_reported_share: string;
  self_reported_capped: boolean;
  distinct_observers: number;
  span_days: number;
  suppression_reason: string | null;
  gate_capped_by: string | null;
}): DimensionResult {
  const common = {
    dimension: row.dimension,
    coverage_tier: row.coverage_tier,
    confidence: row.confidence,
    n_eff: row.n_eff,
    observation_count: row.observation_count,
    rejected_provenance_count: row.rejected_provenance_count,
    self_reported_share: row.self_reported_share,
    self_reported_capped: row.self_reported_capped,
    distinct_observers: row.distinct_observers,
    span_days: row.span_days,
    gate_capped_by: row.gate_capped_by,
  };
  // Same rule one level down: a withheld dimension has no score field, so the
  // eight-row dimension table cannot print a 0 for the three checks the harness
  // never got to run.
  if (row.score === null) {
    return { ...common, state: "withheld", suppression_reason: row.suppression_reason };
  }
  return { ...common, state: "scored", score: row.score, score_low: row.score_low, score_high: row.score_high };
}

/**
 * Gates and gaps out of the stored result.
 *
 * Tolerant readers, because these come from a jsonb column: a row written by an
 * older engine that did not emit the key yields an empty list, which is the
 * type's own meaning of "none". Nothing here fabricates an entry.
 */
function readGates(result: unknown): FiredGate[] {
  const v = (result as { gates_fired?: unknown }).gates_fired;
  return Array.isArray(v) ? (v as FiredGate[]) : [];
}

function readHarnessGaps(result: unknown): HarnessGap[] {
  const v = (result as { harness_gaps?: unknown }).harness_gaps;
  return Array.isArray(v) ? (v as HarnessGap[]) : [];
}

/**
 * The subject's source as it stood on the day that was scored, read from the
 * snapshot's own frame rather than from the current `subjects` row.
 *
 * A subject that has since moved registries or changed its URL must not have
 * yesterday's rating relabelled with today's identity. Null when the frame
 * carried none; no placeholder is substituted.
 */
function readSource(frame: unknown): SubjectSource | null {
  const s = (frame as { source?: unknown }).source;
  if (typeof s !== "object" || s === null) return null;
  const o = s as Record<string, unknown>;
  if (typeof o["registry"] !== "string" || typeof o["ref"] !== "string") return null;
  return {
    registry: o["registry"],
    ref: o["ref"],
    url: typeof o["url"] === "string" ? o["url"] : null,
  };
}

/**
 * The db handle, created once and only when a DATABASE_URL exists.
 *
 * Module scope rather than per request: a pool per request would open six
 * hundred connections to render one listing. Next's dev server reloads this
 * module on edit, which drops the pool; that is a development cost and not a
 * correctness one.
 */
let handle: DbHandle | null = null;

function db(url: string): DbHandle {
  handle ??= createDb(url);
  return handle;
}

/** Release the pool. Used by tests; the server holds it for its lifetime. */
export async function closeRatingsPool(): Promise<void> {
  const h = handle;
  handle = null;
  if (h) await h.close();
}

export class PostgresRatingsSource implements RatingsSource {
  private readonly url: string;

  constructor(url: string) {
    if (url === "") throw new Error("PostgresRatingsSource needs a DATABASE_URL");
    this.url = url;
  }

  async listSubjects(q: SubjectListQuery): Promise<SubjectPage> {
    const { db: d } = db(this.url);
    const limit = clampLimit(q.limit ?? null);
    const offset = decodeCursor(q.cursor ?? null);
    const base = {
      kind: q.kind,
      profile_id: q.profile_id ?? DEFAULT_PROFILE_ID,
      throughDay: q.through_day ?? todayUtc(),
      ...(q.source_registry === undefined ? {} : { source_registry: q.source_registry }),
    };

    const page = await readLatestSnapshotPage(d, {
      ...base,
      state: q.state ?? "all",
      order: q.order ?? "composite_desc",
      limit,
      offset,
    });

    // The denominator, so a caller can say "161 of 600" without a second call.
    // When no filter is in force it is the same query and the same number, so
    // the second round trip is skipped rather than duplicated.
    const total_unfiltered =
      q.state === undefined || q.state === "all"
        ? page.total
        : (await readLatestSnapshotPage(d, { ...base, state: "all", limit: 1 })).total;

    const nextOffset = offset + page.items.length;
    return {
      items: page.items.map(toSnapshot),
      next_cursor: nextOffset < page.total ? encodeCursor(nextOffset) : null,
      total: page.total,
      total_unfiltered,
    };
  }

  async getSubject(ref: SubjectRef, q?: SubjectDetailQuery): Promise<SubjectDetail | null> {
    const { db: d } = db(this.url);
    const profile_id = q?.profile_id ?? DEFAULT_PROFILE_ID;
    const row = await readLatestSnapshot(d, {
      ...ref,
      profile_id,
      throughDay: q?.through_day ?? todayUtc(),
    });
    if (row === null) return null;

    const dims = await readDimensionScores(d, { ...ref, profile_id, utc_day: row.utc_day });
    return {
      ...toSnapshot(row),
      source: readSource(row.frame_json),
      dimensions: dims.map(toDimension),
      gates_fired: readGates(row.result_json),
      harness_gaps: readHarnessGaps(row.result_json),
    };
  }

  async getSubjectSeries(ref: SubjectRef, q?: SubjectSeriesQuery): Promise<SubjectSeries | null> {
    const { db: d } = db(this.url);
    const profile_id = q?.profile_id ?? DEFAULT_PROFILE_ID;
    const throughDay = q?.through_day ?? todayUtc();
    const days = q?.days ?? SERIES_DAYS;

    // readSnapshotSeries returns every day in the window, including the ones
    // with no row — which is the point of calling it rather than reading the
    // rows and inferring. A caller that only saw the rows could not tell a
    // sparse series from a short one.
    const series = await readSnapshotSeries(d, {
      ...ref,
      profile_id,
      throughDay,
      days,
      ...(q?.collector === undefined ? {} : { collector: q.collector }),
    });

    // A subject with no stored day in the window is not a subject with a
    // thirty-day hole; it is a subject we do not have. 404, not an empty chart.
    if (!series.some((s) => s.state === "withheld" || s.state === "scored")) return null;

    return {
      ref,
      profile_id,
      days: series.map(toRatingDay),
      from_day: series[0]?.utc_day ?? throughDay,
      through_day: throughDay,
    };
  }

  async listKinds(): Promise<RatedKind[]> {
    const { db: d } = db(this.url);
    return readRatedKinds(d, { throughDay: todayUtc() });
  }

  async getHealth(): Promise<RatingsHealth> {
    const { db: d } = db(this.url);
    const ledger = await readRunLedger(d, { limit: SERIES_DAYS });
    return {
      runs: ledger.runs.map((r) => ({
        collector: r.collector,
        utc_day: r.utc_day,
        status: r.status,
        started_at: iso(r.started_at),
        finished_at: r.finished_at === null ? null : iso(r.finished_at),
        subjects_seen: r.subjects_seen,
        results_published: r.results_published,
        results_withheld: r.results_withheld,
        subjects_failed: r.subjects_failed,
        error: r.error,
      })),
      latest_stored_day: ledger.latest_stored_day,
    };
  }
}

/**
 * The db package's SnapshotDay to the wire RatingDay.
 *
 * A mapping and not a re-export, so the wire contract does not move when the
 * store's internal shape does, and so the fixture source has something to
 * satisfy that is not a database type.
 */
function toRatingDay(d: SnapshotDay): RatingDay {
  if (d.state === "not_run" || d.state === "not_assessed") {
    return { utc_day: d.utc_day, state: d.state };
  }
  // Discriminating on the store's own union rather than reading optional
  // fields: every value below is guaranteed present by the variant, so there is
  // no `?? 0` anywhere here filling a hole with a number nobody measured.
  const common = {
    utc_day: d.utc_day,
    coverage: {
      dimension_coverage: d.dimension_coverage,
      assessment_completeness: d.assessment_completeness,
    },
    observation_count: d.observation_count,
    digests: { profile_digest: d.profile_digest, rubric_version: d.rubric_version },
  };
  if (d.state === "withheld") {
    return { ...common, state: "withheld", suppression_reason: d.suppression_reason };
  }
  return {
    ...common,
    state: "scored",
    composite: d.composite,
    composite_low: d.composite_low,
    composite_high: d.composite_high,
    composite_confidence: d.composite_confidence,
    coverage_tier: d.coverage_tier,
  };
}
