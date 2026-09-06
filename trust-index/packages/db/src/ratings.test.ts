/**
 * Daily snapshot store.
 *
 * The pure-function tests always run. The store tests need a real Postgres and
 * skip without one — deliberately skip rather than mock, because every
 * bug worth catching here (the retention boundary, upsert-vs-replace, a
 * composite that is NULL rather than absent) is a bug in what Postgres does
 * with the statement, and a mock would agree with whatever I wrote.
 *
 *   TRUST_INDEX_TEST_DB_URL=postgres://... pnpm --filter @trust-index/db test
 */
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import type { DimensionScore, SubjectScoreResult } from "@trust-index/types";
import { createDb, type DbHandle } from "./client.js";
import {
  compositeCoverageTier,
  pruneExpiredSnapshots,
  readSnapshotSeries,
  RETENTION_DAYS,
  shiftUtcDay,
  utcDay,
  writeDailySnapshot,
} from "./ratings.js";
import { collection_runs, rating_dimension_scores, rating_results } from "./schema.js";

describe("utcDay / shiftUtcDay", () => {
  it("takes the UTC day, not the local one", () => {
    expect(utcDay(new Date("2026-09-06T23:59:59Z"))).toBe("2026-09-06");
    expect(utcDay(new Date("2026-09-07T00:00:00Z"))).toBe("2026-09-07");
  });

  it("crosses month, year and leap-day boundaries", () => {
    expect(shiftUtcDay("2026-09-01", -1)).toBe("2026-08-31");
    expect(shiftUtcDay("2026-01-01", -1)).toBe("2025-12-31");
    expect(shiftUtcDay("2028-03-01", -1)).toBe("2028-02-29");
    expect(shiftUtcDay("2026-08-31", 1)).toBe("2026-09-01");
  });

  it("keeps exactly RETENTION_DAYS days including the day written", () => {
    // The off-by-one that matters: a 30-day retention has to leave 30 readable
    // days, not 31. The cutoff is the OLDEST day kept, and the delete is
    // strictly less than it.
    const cutoff = shiftUtcDay("2026-09-06", -(RETENTION_DAYS - 1));
    expect(cutoff).toBe("2026-08-08");
    let kept = 0;
    for (let d = cutoff; d <= "2026-09-06"; d = shiftUtcDay(d, 1)) kept += 1;
    expect(kept).toBe(30);
  });
});

const dim = (over: Partial<DimensionScore>): DimensionScore => ({
  dimension: "functional_correctness",
  score: 80,
  score_low: 70,
  score_high: 90,
  confidence: 0.5,
  n_eff: 3,
  coverage_tier: "moderate",
  observation_count: 3,
  rejected_provenance_count: 0,
  self_reported_share: 0,
  self_reported_capped: false,
  distinct_observers: 1,
  span_days: 1,
  suppression_reason: null,
  gate_capped_by: null,
  ...over,
});

const result = (over: Partial<SubjectScoreResult> = {}): SubjectScoreResult => ({
  rating_methodology_version: "0.1.0",
  profile_id: "mcp_server.v2",
  kind: "mcp_server",
  subject_id: "s1",
  computed_at: "2026-09-06T05:11:04Z",
  composite: 74.25,
  composite_low: 60,
  composite_high: 88,
  composite_confidence: 0.42,
  dimension_coverage: 0.81,
  assessment_completeness: 1,
  composite_suppression_reason: null,
  lifecycle: "live",
  dimensions: [dim({})],
  gates_fired: [],
  harness_gaps: [],
  observer_weights: [{ observer_id: "probe:mcp:v1", weight: 1 }],
  signals: {},
  profile_digest: "pd-1",
  inputs_hash: "ih-1",
  ...over,
});

describe("compositeCoverageTier", () => {
  it("takes the weakest PUBLISHED dimension, not the best", () => {
    const r = result({
      dimensions: [
        dim({ dimension: "a", coverage_tier: "strong" }),
        dim({ dimension: "b", coverage_tier: "thin" }),
      ],
    });
    expect(compositeCoverageTier(r)).toBe("thin");
  });

  it("ignores withheld dimensions, which have no evidence to contribute", () => {
    // A dimension that published nothing must not drag the tier down: it is
    // already absent from the composite's weight.
    const r = result({
      dimensions: [
        dim({ dimension: "a", coverage_tier: "strong" }),
        dim({ dimension: "b", coverage_tier: "none", score: null, suppression_reason: "thin" }),
      ],
    });
    expect(compositeCoverageTier(r)).toBe("strong");
  });

  it("is none when nothing published", () => {
    expect(compositeCoverageTier(result({ dimensions: [dim({ score: null })] }))).toBe("none");
    expect(compositeCoverageTier(result({ dimensions: [] }))).toBe("none");
  });
});

// Provided by test/globalSetup.ts: a container it started, a URL the operator
// supplied via TRUST_INDEX_TEST_DB_URL, or "" when neither was available.
const url = inject("dbUrl");
const withDb = url === "" || url === undefined ? describe.skip : describe;

withDb("daily snapshot store (needs a database)", () => {
  let h: DbHandle;
  const KEY = { kind: "mcp_server", source_registry: "test", profile_id: "mcp_server.v2" };

  beforeAll(async () => {
    h = createDb(url);
    await h.db.delete(rating_dimension_scores);
    await h.db.delete(rating_results);
    await h.db.delete(collection_runs);
  });
  afterAll(async () => {
    await h?.close();
  });

  const write = async (subject_id: string, day: string, r: SubjectScoreResult, obs = 5) =>
    writeDailySnapshot(h.db, {
      ...KEY,
      subject_id,
      utc_day: day,
      result: { ...r, subject_id },
      frame: { priors: {}, constants: {} },
      observation_count: obs,
      rubric_version: "mcp.rubric.v2",
      run_id: `run-${day}`,
    });

  it("round-trips a scored day", async () => {
    await write("round-trip", "2026-09-06", result());
    const series = await readSnapshotSeries(h.db, {
      ...KEY,
      subject_id: "round-trip",
      throughDay: "2026-09-06",
      days: 1,
    });
    expect(series).toHaveLength(1);
    const day = series[0];
    expect(day?.state).toBe("scored");
    if (day?.state !== "scored") throw new Error("unreachable");
    expect(day.composite).toBe("74.25");
    expect(day.coverage_tier).toBe("moderate");
    expect(day.rubric_version).toBe("mcp.rubric.v2");
  });

  it("STORES a withheld day rather than skipping it", async () => {
    // The distinction the whole three-state design exists for. A withheld day
    // must come back as withheld-with-a-reason, never as a hole.
    await write(
      "withheld",
      "2026-09-06",
      result({
        composite: null,
        composite_low: null,
        composite_high: null,
        composite_suppression_reason: "n_eff below suppression floor",
        dimensions: [dim({ score: null, coverage_tier: "thin", suppression_reason: "thin" })],
      }),
      1,
    );
    const [day] = await readSnapshotSeries(h.db, {
      ...KEY,
      subject_id: "withheld",
      throughDay: "2026-09-06",
      days: 1,
    });
    expect(day?.state).toBe("withheld");
    if (day?.state !== "withheld") throw new Error("unreachable");
    expect(day.suppression_reason).toBe("n_eff below suppression floor");
    expect(day.observation_count).toBe(1);
  });

  it("tells apart all four states across a series", async () => {
    // 09-01 the job never ran. 09-02 it ran but this subject was not in it.
    // 09-03 it ran and withheld. 09-04 it ran and scored.
    for (const d of ["2026-09-02", "2026-09-03", "2026-09-04"]) {
      await h.db.insert(collection_runs).values({
        run_id: `mcp-${d}`,
        collector: "mcp",
        utc_day: d,
        started_at: new Date(`${d}T02:00:00Z`),
        finished_at: new Date(`${d}T03:00:00Z`),
        status: "succeeded",
      });
    }
    await write("four-states", "2026-09-03", result({ composite: null, composite_suppression_reason: "thin" }));
    await write("four-states", "2026-09-04", result());

    const series = await readSnapshotSeries(h.db, {
      ...KEY,
      subject_id: "four-states",
      throughDay: "2026-09-04",
      days: 4,
      collector: "mcp",
    });
    expect(series.map((d) => `${d.utc_day}:${d.state}`)).toEqual([
      "2026-09-01:not_run",
      "2026-09-02:not_assessed",
      "2026-09-03:withheld",
      "2026-09-04:scored",
    ]);
  });

  it("does not count a failed run as a run", async () => {
    await h.db.insert(collection_runs).values({
      run_id: "mcp-2026-09-05",
      collector: "mcp",
      utc_day: "2026-09-05",
      started_at: new Date("2026-09-05T02:00:00Z"),
      status: "failed",
      error: "collector died",
    });
    const [day] = await readSnapshotSeries(h.db, {
      ...KEY,
      subject_id: "four-states",
      throughDay: "2026-09-05",
      days: 1,
      collector: "mcp",
    });
    // A night that produced nothing to score is "not_run" to a reader, whatever
    // row the ledger holds.
    expect(day?.state).toBe("not_run");
  });

  it("re-scoring a day replaces its dimensions instead of leaving stale ones", async () => {
    await write(
      "rescore",
      "2026-09-06",
      result({ dimensions: [dim({ dimension: "a" }), dim({ dimension: "b" })] }),
    );
    // The second run publishes only one dimension — a harness gap opened. The
    // vanished dimension must not survive with yesterday's score.
    await write("rescore", "2026-09-06", result({ dimensions: [dim({ dimension: "a", score: 55 })] }));
    const rows = await h.db
      .select()
      .from(rating_dimension_scores)
      .where(eqAll("rescore", "2026-09-06"));
    expect(rows.map((r) => r.dimension)).toEqual(["a"]);
    expect(rows[0]?.score).toBe("55.00");
    const all = await h.db.select().from(rating_results);
    expect(all.filter((r) => r.subject_id === "rescore")).toHaveLength(1);
  });

  it("prunes to exactly the retention window, and takes dimension rows with it", async () => {
    const through = "2026-09-06";
    const oldest = shiftUtcDay(through, -(RETENTION_DAYS - 1)); // kept
    const expired = shiftUtcDay(oldest, -1); // dropped
    await write("retention", expired, result());
    await write("retention", oldest, result());
    await write("retention", through, result());

    const pruned = await pruneExpiredSnapshots(h.db, through);
    expect(pruned.cutoff).toBe(oldest);
    expect(pruned.results_deleted).toBeGreaterThanOrEqual(1);
    expect(pruned.dimensions_deleted).toBeGreaterThanOrEqual(1);

    const kept = await h.db.select().from(rating_results);
    const days = kept.filter((r) => r.subject_id === "retention").map((r) => r.utc_day).sort();
    expect(days).toEqual([oldest, through]);
    // No orphans: nothing in the dimension table older than the cutoff.
    const dims = await h.db.select().from(rating_dimension_scores);
    expect(dims.filter((d) => d.utc_day < oldest)).toHaveLength(0);
  });
});

/** Narrow the dimension table to one subject-day. Kept out of the test body for readability. */
function eqAll(subject_id: string, utc_day: string) {
  const t = rating_dimension_scores;
  return and(
    eq(t.kind, "mcp_server"),
    eq(t.source_registry, "test"),
    eq(t.subject_id, subject_id),
    eq(t.profile_id, "mcp_server.v2"),
    eq(t.utc_day, utc_day),
  );
}
