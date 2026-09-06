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
const asOfTs = `${new Date().toISOString().slice(0, 19)}Z`;

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

const probe = {
  first_seen_ts: process.env["PROBE_SINCE"] ?? "2024-09-01T00:00:00Z",
  total_observations: 4000,
  distinct_subjects: 600,
  max_observations_single_day: 400,
};

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

const files = readdirSync(join(root, "transcripts")).filter((f) => f.endsWith(".json"));
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
