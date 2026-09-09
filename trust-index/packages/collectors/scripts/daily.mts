/**
 * The daily job. Transcripts and battery outcomes in, one day of snapshots out.
 *
 * This is `rate-population.mts` with the results kept. That script proved the
 * path end to end — a server goes in, a rating comes out — and then printed
 * counts and threw the ratings away. Everything below it is the same assembly
 * and the same scoreSubject call; what is new is that the evidence, the gaps
 * and the day's score land in Postgres, and that the run says in a ledger
 * whether it happened.
 *
 * Usage:
 *   DATABASE_URL=postgres://... pnpm exec tsx scripts/daily.mts [--day 2026-09-06] [--dry-run]
 *
 * Idempotent. Re-running a day reopens its ledger row, re-writes its snapshots,
 * and lands no duplicate observations — an observation's identity is its check
 * at an instant, so the same reading written twice is one row.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  createDb,
  finishRun,
  persistScoredSubject,
  pruneExpiredSnapshots,
  shiftUtcDay,
  startRun,
  utcDay,
  type RunCounters,
} from "@trust-index/db";
import { scoreSubject } from "@trust-index/scoring";
import { transcriptToSubject, batteryGaps } from "../src/mcp/subject.js";
import { transcriptGaps } from "../src/mcp/assess.js";
import type { BatteryOutcome } from "../src/mcp/battery.js";
import type { ProbeTranscript } from "../src/mcp/transcript.js";

const COLLECTOR = "mcp";

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(name);
  return i === -1 ? fallback : (process.argv[i + 1] ?? fallback);
}
const dryRun = process.argv.includes("--dry-run");

/**
 * Which day this run belongs to.
 *
 * Defaults to today in UTC and is overridable, because a job that fires at
 * 00:05 UTC and a backfill of last Tuesday are the same code and must not both
 * claim to be "today". Everything downstream — the snapshot key, the ledger
 * row, the volume cap — keys on this one value.
 */
const day = arg("--day", utcDay(new Date()));
if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) {
  console.error(`--day must be YYYY-MM-DD, got ${JSON.stringify(day)}`);
  process.exit(2);
}

const url = process.env["DATABASE_URL"];
if (url === undefined || url === "") {
  console.error("DATABASE_URL is not set. The daily job persists; there is nowhere to put this.");
  process.exit(2);
}

const root = join(import.meta.dirname, "..");

/**
 * As-of is a function of the DAY, not of the clock.
 *
 * This was `new Date()`, and that was wrong in a way only re-running showed.
 * `as_of_ts` is what observation decay and lifecycle are measured from, and it
 * is inside `inputs_hash` — so scoring the same day twice produced slightly
 * different composites AND a different hash for identical evidence. Measured:
 * two of 600 composites moved on a re-run with no code change at all, and every
 * inputs_hash moved. That defeats the reproducibility the snapshot rests on,
 * where a reader rebuilds the subject from the stored frame plus the day's
 * observations and checks the result against the stored hash.
 *
 * It is worse for backfills, which is the case that makes it obvious:
 * re-scoring last August with today's clock decays that day's evidence by
 * everything that has happened since, and calls the result last August's
 * rating.
 *
 * The day's exclusive end boundary is the natural choice. Every run of day D —
 * tonight's, tomorrow's retry, a backfill next year — evaluates as of the same
 * instant, so the snapshot is a function of the evidence and nothing else. For
 * a run early in its own day this is a few hours ahead of the wall clock, which
 * costs nothing real: the decay half-life is 120 days and lifecycle thresholds
 * are whole days. `computed_at` on the row still records the actual clock
 * reading, which is where "when did this run" belongs.
 */
const asOfTs = `${shiftUtcDay(day, 1)}T00:00:00Z`;

// Behavioural evidence, keyed by ENDPOINT. The assessment file is per tool; a
// subject is a server, so outcomes are grouped before assembly. The join is on
// endpoint rather than name because the two files sanitise names differently
// ("ai.x/y" against "ai.x_y") and joining on those silently matched nothing.
const assessmentFile = arg("--assessment", "assessment-rubric-v2.json");
const battery = new Map<string, BatteryOutcome[]>();
try {
  const raw = JSON.parse(readFileSync(join(root, assessmentFile), "utf8")) as Array<
    BatteryOutcome & { endpoint?: string }
  >;
  for (const o of raw) {
    const k = o.endpoint ?? "(unknown)";
    battery.set(k, [...(battery.get(k) ?? []), o]);
  }
} catch {
  // No battery run: every judged check becomes a harness gap, which is the
  // correct reading. It is not evidence about the subject.
}

const files = readdirSync(join(root, "transcripts")).filter((f) => f.endsWith(".json"));

/**
 * The probe observer's own track record — MEASURED, not asserted.
 *
 * These three were hardcoded at 4000/600/400, which described the 600-subject
 * pilot and stopped being true the moment the sweep reached the whole registry.
 * They are not idle: `inputs_hash` covers them (hash.ts), so every published
 * snapshot carried a false claim about how much of the world this harness has
 * actually looked at — in the one field a reader would use to audit that claim.
 *
 * They do NOT feed the velocity penalty; that applies only to `reviewer` and
 * `publisher` observers, never to a probe (weights.ts). So this is a
 * truthfulness fix, not a scoring change: composites are unaffected, hashes
 * move, and they move to the number we can defend.
 *
 * `distinct_subjects` is the transcript count. The observation totals come from
 * a pre-pass that assembles each subject and counts what it yields — assembly is
 * cheap next to scoring, and an observation count does not depend on the
 * observer's reputation fields, so counting first and scoring second is sound.
 * `total_observations` is this sweep's volume, which is a floor on the harness's
 * lifetime output and is stated as such rather than guessed upward.
 */
const provisionalProbe = {
  first_seen_ts: process.env["PROBE_SINCE"] ?? "2024-09-01T00:00:00Z",
  total_observations: 1,
  distinct_subjects: 1,
  max_observations_single_day: 1,
};
let sweepObservations = 0;
for (const f of files) {
  try {
    const t = JSON.parse(readFileSync(join(root, "transcripts", f), "utf8")) as ProbeTranscript;
    const b = battery.get(t.endpoint) ?? [];
    sweepObservations += transcriptToSubject(t, {
      probe: provisionalProbe,
      asOfTs,
      gaps: [...transcriptGaps(t), ...batteryGaps(b)],
      battery: b,
    }).observations.length;
  } catch {
    // A transcript that will not assemble contributes no observations. It is
    // counted as a scoring failure in the real pass, where it can be named.
  }
}

const probe = {
  first_seen_ts: process.env["PROBE_SINCE"] ?? "2024-09-01T00:00:00Z",
  total_observations: sweepObservations,
  distinct_subjects: files.length,
  // One full sweep lands in one day, so the day's volume IS the sweep's volume.
  max_observations_single_day: sweepObservations,
};
console.log(
  `probe observer: ${probe.distinct_subjects} subjects, ${probe.total_observations} observations this sweep`,
);

const { db, close } = createDb(url);
const counters: RunCounters = {
  subjects_seen: 0,
  observations_written: 0,
  gaps_written: 0,
  results_published: 0,
  results_withheld: 0,
  subjects_failed: 0,
};

const run_id = dryRun
  ? `dry-run:${day}`
  : await startRun(db, {
      collector: COLLECTOR,
      utc_day: day,
      detail: { assessment_file: assessmentFile, argv: process.argv.slice(2) },
    });
console.log(`run ${run_id}  day=${day}  battery for ${battery.size} servers${dryRun ? "  (DRY RUN)" : ""}`);

const failures: string[] = [];

try {
  for (const f of files) {
    let t: ProbeTranscript;
    try {
      t = JSON.parse(readFileSync(join(root, "transcripts", f), "utf8")) as ProbeTranscript;
    } catch {
      continue;
    }
    counters.subjects_seen += 1;
    try {
      const b = battery.get(t.endpoint) ?? [];
      const subject = transcriptToSubject(t, {
        probe,
        asOfTs,
        gaps: [...transcriptGaps(t), ...batteryGaps(b)],
        battery: b,
      });
      const { result } = scoreSubject(subject);

      if (result.composite === null) counters.results_withheld += 1;
      else counters.results_published += 1;
      counters.observations_written += subject.observations.length;
      counters.gaps_written += subject.gaps.length;

      if (!dryRun) await persistScoredSubject(db, { subject, result, utc_day: day, run_id });
    } catch (err) {
      // One subject that will not assemble or score is not a failed run. It is
      // counted, named, and the other three hundred still get their day.
      counters.subjects_failed += 1;
      if (failures.length < 20) {
        failures.push(`${f}: ${err instanceof Error ? err.message.slice(0, 160) : String(err)}`);
      }
    }
  }

  // Retention, and ONLY on a run that got this far. A night that died halfway
  // must not also delete the oldest day it still had — that is how a broken
  // collector quietly eats the history it was supposed to be building.
  let pruned = { cutoff: "(skipped)", results_deleted: 0, dimensions_deleted: 0 };
  if (!dryRun) pruned = await pruneExpiredSnapshots(db, day);

  if (!dryRun) await finishRun(db, run_id, { status: "succeeded", counters });

  console.log(
    `\n  subjects seen      ${counters.subjects_seen}` +
      `\n  published          ${counters.results_published}` +
      `\n  withheld           ${counters.results_withheld}` +
      `\n  failed to score    ${counters.subjects_failed}` +
      `\n  observations       ${counters.observations_written}` +
      `\n  gaps               ${counters.gaps_written}` +
      `\n  pruned before      ${pruned.cutoff} (${pruned.results_deleted} snapshots, ${pruned.dimensions_deleted} dimension rows)`,
  );
  if (failures.length > 0) {
    console.log(`\n  first ${failures.length} scoring failures:`);
    for (const line of failures) console.log(`    ${line}`);
  }
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  if (!dryRun) await finishRun(db, run_id, { status: "failed", error: message.slice(0, 500), counters });
  console.error(`\nRUN FAILED: ${message}`);
  await close();
  process.exit(1);
}

await close();
