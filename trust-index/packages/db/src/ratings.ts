/**
 * Daily rating snapshots: write one, read the last 30, drop the rest.
 *
 * The scope here is deliberately small. One snapshot per subject per profile
 * per UTC day, retained 30 days, and NOTHING that averages them. Rolling
 * day/week/month scores were designed and then cut before they were built,
 * because the question "what is the right way to combine days" is genuinely
 * open and a stored aggregate column is the worst place to answer it: it
 * cannot be recomputed, revised, or argued with once consumers read it.
 *
 * So this module stores a series and stops. `readSnapshotSeries` hands back the
 * 30 days in a shape an averaging pass could consume later, and the two rules
 * that pass will have to obey are written down in `schema.ts` beside the table,
 * where whoever writes it will be looking.
 */
import { and, asc, desc, eq, inArray, lt, sql } from "drizzle-orm";
import type { SubjectScoreResult } from "@trust-index/types";
import type { Db } from "./client.js";
import { collection_runs, rating_dimension_scores, rating_results } from "./schema.js";

/**
 * How many days of history we keep.
 *
 * Thirty because that is what was asked for, and it is worth being explicit
 * that it is a product decision rather than a technical limit: nothing here
 * gets slower at ninety. Raising it is a constant change plus a backfill; the
 * data that has already been pruned does not come back, which is the only
 * irreversible thing in this file.
 */
export const RETENTION_DAYS = 30;

/** The UTC day a timestamp belongs to, as YYYY-MM-DD. */
export function utcDay(at: Date): string {
  return at.toISOString().slice(0, 10);
}

/** N days before a UTC day, as YYYY-MM-DD. Used for retention and for series bounds. */
export function shiftUtcDay(day: string, deltaDays: number): string {
  const at = new Date(`${day}T00:00:00Z`);
  at.setUTCDate(at.getUTCDate() + deltaDays);
  return utcDay(at);
}

/**
 * The composite's coverage tier, derived here because the engine does not emit
 * one for the composite — only per dimension.
 *
 * The rule: the weakest tier among the dimensions that actually published. A
 * composite is a roll-up, and a roll-up cannot be better evidenced than its
 * thinnest published input. Taking the best tier, or a mean of them, would let
 * one well-observed dimension carry a `strong` label onto a rating whose other
 * halves rest on a single reading.
 *
 * `basis` is stored beside the value so this can be superseded without
 * ambiguity if the methodology later defines a composite tier of its own. A
 * derived number with no record of the rule that derived it is the thing that
 * makes a later migration guesswork.
 */
export const COVERAGE_TIER_BASIS = "min_published_dimension";

const TIER_ORDER = ["none", "thin", "moderate", "strong"] as const;
export type CoverageTier = (typeof TIER_ORDER)[number];

export function compositeCoverageTier(result: SubjectScoreResult): CoverageTier {
  const published = result.dimensions.filter((d) => d.score !== null);
  if (published.length === 0) return "none";
  let worst = TIER_ORDER.length - 1;
  for (const d of published) {
    const at = TIER_ORDER.indexOf(d.coverage_tier as CoverageTier);
    if (at !== -1 && at < worst) worst = at;
  }
  return TIER_ORDER[worst] as CoverageTier;
}

/** Numerics are stored exact and read back as strings; nulls stay null. */
const num = (v: number | null): string | null => (v === null ? null : String(v));

export type SnapshotWrite = {
  kind: string;
  source_registry: string;
  subject_id: string;
  /** The UTC day this snapshot covers. Pass the run's day, not `new Date()`. */
  utc_day: string;
  result: SubjectScoreResult;
  /**
   * The Subject as scored MINUS its observations — priors, constants,
   * observers, gaps. See the frame_json comment in schema.ts for why the
   * observations are deliberately not duplicated here.
   */
  frame: unknown;
  /** Observations on this day before the engine dropped any. Zero is a real value. */
  observation_count: number;
  /** The collector code that produced those observations, e.g. "mcp.rubric.v2". */
  rubric_version: string;
  run_id: string | null;
};

/**
 * Write one day's snapshot for one subject.
 *
 * Upsert rather than insert, keyed on (subject, profile, day), so re-running a
 * day replaces it instead of failing or duplicating. A day that is scored twice
 * — a retry, a manual re-run after fixing a harness gap — should end up with
 * the later answer, and the digests on the row say which rubric produced it.
 *
 * A WITHHELD SNAPSHOT IS WRITTEN, NOT SKIPPED. `composite` is null, the
 * suppression reason is stored, and the row exists. Skipping it would collapse
 * "we assessed this and could not publish" into "we never looked", and those
 * are different facts that a reader of the series has to be able to tell apart.
 */
export async function writeDailySnapshot(db: Db, w: SnapshotWrite): Promise<void> {
  const r = w.result;
  const row = {
    kind: w.kind,
    source_registry: w.source_registry,
    subject_id: w.subject_id,
    profile_id: r.profile_id,
    utc_day: w.utc_day,
    computed_at: new Date(r.computed_at),
    rating_methodology_version: r.rating_methodology_version,
    composite: num(r.composite),
    composite_low: num(r.composite_low),
    composite_high: num(r.composite_high),
    composite_confidence: String(r.composite_confidence),
    dimension_coverage: String(r.dimension_coverage),
    assessment_completeness: String(r.assessment_completeness),
    composite_suppression_reason: r.composite_suppression_reason,
    lifecycle: r.lifecycle,
    observation_count: w.observation_count,
    coverage_tier: compositeCoverageTier(r),
    coverage_tier_basis: COVERAGE_TIER_BASIS,
    profile_digest: r.profile_digest,
    inputs_hash: r.inputs_hash,
    rubric_version: w.rubric_version,
    frame_json: w.frame,
    result_json: r,
    run_id: w.run_id,
  };

  await db.transaction(async (tx) => {
    await tx
      .insert(rating_results)
      .values(row)
      .onConflictDoUpdate({
        target: [
          rating_results.kind,
          rating_results.source_registry,
          rating_results.subject_id,
          rating_results.profile_id,
          rating_results.utc_day,
        ],
        set: row,
      });

    // Replace rather than upsert: a re-score can publish fewer dimensions than
    // the run it supersedes (a harness gap that has since opened), and an
    // upsert would leave the vanished dimension's old row behind, still
    // readable, still carrying a score nothing computed today.
    await tx
      .delete(rating_dimension_scores)
      .where(
        and(
          eq(rating_dimension_scores.kind, w.kind),
          eq(rating_dimension_scores.source_registry, w.source_registry),
          eq(rating_dimension_scores.subject_id, w.subject_id),
          eq(rating_dimension_scores.profile_id, r.profile_id),
          eq(rating_dimension_scores.utc_day, w.utc_day),
        ),
      );
    if (r.dimensions.length > 0) {
      await tx.insert(rating_dimension_scores).values(
        r.dimensions.map((d) => ({
          kind: w.kind,
          source_registry: w.source_registry,
          subject_id: w.subject_id,
          profile_id: r.profile_id,
          utc_day: w.utc_day,
          dimension: d.dimension,
          score: num(d.score),
          score_low: num(d.score_low),
          score_high: num(d.score_high),
          confidence: String(d.confidence),
          n_eff: String(d.n_eff),
          coverage_tier: d.coverage_tier,
          observation_count: d.observation_count,
          rejected_provenance_count: d.rejected_provenance_count,
          self_reported_share: String(d.self_reported_share),
          self_reported_capped: d.self_reported_capped,
          distinct_observers: d.distinct_observers,
          span_days: d.span_days,
          suppression_reason: d.suppression_reason,
          gate_capped_by: d.gate_capped_by,
        })),
      );
    }
  });
}

/**
 * Drop snapshots older than the retention window.
 *
 * Called by the daily job after it writes, with the day it just wrote. Keeps
 * RETENTION_DAYS days INCLUDING that day, so a 30-day retention leaves 30
 * readable days and not 31.
 *
 * Deliberately not a cascade: `rating_dimension_scores` has no foreign key to
 * `rating_results` (nothing in this schema does), so both are pruned here
 * explicitly. Missing the second one would leave orphaned dimension rows that
 * no series query returns and nothing ever deletes.
 */
export async function pruneExpiredSnapshots(
  db: Db,
  throughDay: string,
  retentionDays: number = RETENTION_DAYS,
): Promise<{ cutoff: string; results_deleted: number; dimensions_deleted: number }> {
  const cutoff = shiftUtcDay(throughDay, -(retentionDays - 1));
  const results = await db.delete(rating_results).where(lt(rating_results.utc_day, cutoff)).returning({
    subject_id: rating_results.subject_id,
  });
  const dims = await db
    .delete(rating_dimension_scores)
    .where(lt(rating_dimension_scores.utc_day, cutoff))
    .returning({ subject_id: rating_dimension_scores.subject_id });
  return { cutoff, results_deleted: results.length, dimensions_deleted: dims.length };
}

/**
 * What one day of a subject's history is.
 *
 * FOUR states, not three, and the fourth is the one that gets lost. The three
 * the schema comment names — never ran, ran and withheld, ran and scored — plus
 * "the job ran that day and this subject was not in it", which happens to every
 * subject added to the registry partway through a window and to every subject
 * dropped from it. Rendering that as "no data" alongside a night the job never
 * started tells a reader the same thing about two different facts.
 */
export type SnapshotDay =
  /** The daily job has no succeeded run for this day. The gap is ours. */
  | { utc_day: string; state: "not_run" }
  /** The job ran; this subject was not among the subjects it scored. */
  | { utc_day: string; state: "not_assessed" }
  /** Assessed and deliberately not published, with the reason the engine gave. */
  | {
      utc_day: string;
      state: "withheld";
      suppression_reason: string | null;
      dimension_coverage: string;
      assessment_completeness: string;
      observation_count: number;
      rubric_version: string;
      profile_digest: string;
    }
  /** Assessed and published. */
  | {
      utc_day: string;
      state: "scored";
      composite: string;
      composite_low: string | null;
      composite_high: string | null;
      composite_confidence: string;
      coverage_tier: string;
      dimension_coverage: string;
      assessment_completeness: string;
      observation_count: number;
      rubric_version: string;
      profile_digest: string;
    };

/**
 * One subject's last N days, oldest first, with every day present.
 *
 * Every day in the range gets an entry, including the ones with no row — that
 * is the point. A caller that only reads the rows it finds cannot distinguish a
 * sparse series from a short one, and will draw a line straight through a
 * fortnight the collector was broken.
 */
export async function readSnapshotSeries(
  db: Db,
  q: {
    kind: string;
    source_registry: string;
    subject_id: string;
    profile_id: string;
    /** Most recent day to include, usually today. */
    throughDay: string;
    days?: number;
    /** Which collector's runs decide "did we run at all". */
    collector?: string;
  },
): Promise<SnapshotDay[]> {
  const days = q.days ?? RETENTION_DAYS;
  const from = shiftUtcDay(q.throughDay, -(days - 1));
  const wanted: string[] = [];
  for (let i = 0; i < days; i += 1) wanted.push(shiftUtcDay(from, i));

  const rows = await db
    .select()
    .from(rating_results)
    .where(
      and(
        eq(rating_results.kind, q.kind),
        eq(rating_results.source_registry, q.source_registry),
        eq(rating_results.subject_id, q.subject_id),
        eq(rating_results.profile_id, q.profile_id),
        inArray(rating_results.utc_day, wanted),
      ),
    )
    .orderBy(asc(rating_results.utc_day));
  const byDay = new Map(rows.map((r) => [r.utc_day, r]));

  // Which days the collector actually completed. A `running` or `failed` row is
  // not a run for this purpose: it means the night produced nothing to score,
  // which is "not_run" from a reader's point of view even though a row exists.
  const runs = await db
    .select({ utc_day: collection_runs.utc_day })
    .from(collection_runs)
    .where(
      and(
        eq(collection_runs.status, "succeeded"),
        inArray(collection_runs.utc_day, wanted),
        ...(q.collector === undefined ? [] : [eq(collection_runs.collector, q.collector)]),
      ),
    );
  const ran = new Set(runs.map((r) => r.utc_day));

  return wanted.map((utc_day): SnapshotDay => {
    const row = byDay.get(utc_day);
    if (row === undefined) {
      return ran.has(utc_day) ? { utc_day, state: "not_assessed" } : { utc_day, state: "not_run" };
    }
    const common = {
      utc_day,
      dimension_coverage: row.dimension_coverage,
      assessment_completeness: row.assessment_completeness,
      observation_count: row.observation_count,
      rubric_version: row.rubric_version,
      profile_digest: row.profile_digest,
    };
    if (row.composite === null) {
      return { ...common, state: "withheld", suppression_reason: row.composite_suppression_reason };
    }
    return {
      ...common,
      state: "scored",
      composite: row.composite,
      composite_low: row.composite_low,
      composite_high: row.composite_high,
      composite_confidence: row.composite_confidence,
      coverage_tier: row.coverage_tier,
    };
  });
}

/**
 * The most recent snapshot per subject for one kind, for the compendium listing.
 *
 * "Most recent" is per subject and not a single shared day on purpose: a
 * subject the collector could not reach last night still has a rating from the
 * night before, and dropping it from the listing because today's run missed it
 * would make the compendium's contents depend on the last run's luck. The day
 * comes back on every row so a reader can see which are stale.
 */
export async function readLatestSnapshots(
  db: Db,
  q: { kind: string; profile_id: string; throughDay: string; days?: number },
): Promise<Array<typeof rating_results.$inferSelect>> {
  const from = shiftUtcDay(q.throughDay, -((q.days ?? RETENTION_DAYS) - 1));
  return db
    .selectDistinctOn([rating_results.source_registry, rating_results.subject_id])
    .from(rating_results)
    .where(
      and(
        eq(rating_results.kind, q.kind),
        eq(rating_results.profile_id, q.profile_id),
        sql`${rating_results.utc_day} >= ${from}`,
        sql`${rating_results.utc_day} <= ${q.throughDay}`,
      ),
    )
    .orderBy(
      asc(rating_results.source_registry),
      asc(rating_results.subject_id),
      desc(rating_results.utc_day),
    );
}
