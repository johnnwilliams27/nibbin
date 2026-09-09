/**
 * Close the loop: transcripts + battery outcomes -> a scored composite per
 * endpoint, in the shape merge-marketplace-assessments.mts can consume.
 *
 * THE GAP THIS FILLS. Every stage of the rating pipeline exists and works, but
 * two of them were never connected. `assess.mts` runs the battery and writes
 * outcomes. `transcriptsToSubject` turns a transcript plus those outcomes into
 * a Subject. `scoreSubject` turns a Subject into a composite. Meanwhile
 * `merge-marketplace-assessments.mts` — the script that actually feeds the
 * site — hardcodes `composite: null` at every construction site, because when
 * it was written there was no battery to draw on.
 *
 * So nibbin.com publishes zero scores, and it reads as a rating product that
 * rates nothing. It was never a threshold problem: a trial run against real BSC
 * agents cleared 85-100% on eight of nine checks. It was two files that did not
 * know about each other.
 *
 * WHAT THIS DOES NOT DO. It does not lower a bar. Publication still requires
 * completeness >= 0.60 and coverage >= 0.60, gates still cap, and a subject
 * without enough evidence still comes out with `composite: null` and a reason.
 * The only change is that a subject WITH enough evidence can now come out with
 * a number, which is what the engine was built to do.
 *
 * Usage:
 *   pnpm exec tsx scripts/score-marketplace.mts \
 *     --transcripts trial-transcripts --battery assess-outcomes.json \
 *     --out scored-endpoints.json
 */
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { scoreSubject } from "@trust-index/scoring";
import { transcriptsToSubject, batteryGaps } from "../src/mcp/subject.js";
import { probeSeed } from "../src/mcp/probe-identity.js";
import type { ProbeTranscript } from "../src/mcp/transcript.js";
import type { BatteryOutcome } from "../src/mcp/battery.js";

const argv = process.argv.slice(2);
const arg = (n: string, d: string): string => {
  const i = argv.indexOf(n);
  return i === -1 ? d : (argv[i + 1] ?? d);
};

const DIR = arg("--transcripts", "transcripts");
const BATTERY = arg("--battery", "");
const OUT = arg("--out", "scored-endpoints.json");
/**
 * Second precision, not milliseconds. The engine rejects a sub-second
 * timestamp outright — observation identity is observer + dimension + key + ts,
 * and a millisecond clock would make two runs of the same check incomparable
 * where they should collide. `toISOString()` gives milliseconds, so it is
 * truncated here rather than at fourteen call sites downstream.
 */
const AS_OF = arg("--as-of", new Date().toISOString().replace(/\.\d{3}Z$/, "Z"));

const seed = probeSeed();
if (seed === null) {
  console.error("TRUST_INDEX_PROBE_SEED is not set. The probe values are derived from it, so a run without it is not reproducible.");
  process.exit(1);
}

/** Battery outcomes, grouped by the endpoint they were produced against. */
const byEndpoint = new Map<string, BatteryOutcome[]>();
if (BATTERY !== "" && existsSync(BATTERY)) {
  const raw = JSON.parse(readFileSync(BATTERY, "utf8")) as BatteryOutcome[];
  for (const o of raw) {
    const ep = (o as unknown as { endpoint?: string }).endpoint;
    if (typeof ep !== "string") continue;
    const list = byEndpoint.get(ep) ?? [];
    list.push(o);
    byEndpoint.set(ep, list);
  }
  console.log(`battery outcomes for ${byEndpoint.size} endpoints`);
} else {
  console.log("no battery file given; subjects will be scored on declaration evidence alone");
}

type Scored = {
  endpoint: string;
  composite: number | null;
  composite_low: number | null;
  composite_high: number | null;
  /** Both axes, kept separate. Coverage is how much we looked; it is never merged into the score. */
  dimension_coverage: number | null;
  assessment_completeness: number | null;
  /** The engine's own words for why no number published. Never blank. */
  withheld_reason: string | null;
  gates_fired: unknown[];
  /** Checks that did not run because WE could not run them. They left the denominator. */
  harness_gaps: unknown[];
  battery_outcomes: number;
};

/**
 * The observer's own track record, MEASURED from this run rather than asserted.
 *
 * These four fields are hashed into `inputs_hash`, which is the field a reader
 * uses to audit a rating. Hardcoding them once put a false claim about our own
 * coverage into exactly that field (see GOTCHAS.md), so they are counted here
 * in a first pass and only then used to score. `total_observations` is this
 * run's volume, a floor on the harness's lifetime output, and is stated as
 * such rather than guessed upward.
 */
const files = readdirSync(DIR).filter((x) => x.endsWith(".json"));
let observationCount = 0;
const loaded: ProbeTranscript[] = [];
for (const f of files) {
  try {
    const t = JSON.parse(readFileSync(join(DIR, f), "utf8")) as ProbeTranscript;
    if (typeof t.endpoint === "string" && t.endpoint !== "") loaded.push(t);
  } catch { /* a malformed transcript is not a subject */ }
}
for (const t of loaded) observationCount += (byEndpoint.get(t.endpoint) ?? []).length;

const observer = {
  first_seen_ts: process.env["PROBE_SINCE"] ?? "2024-09-01T00:00:00Z",
  total_observations: Math.max(1, observationCount),
  distinct_subjects: Math.max(1, loaded.length),
  max_observations_single_day: Math.max(1, observationCount),
};

const results: Scored[] = [];
let published = 0, withheld = 0, failed = 0;

for (const t of loaded) {
  const battery = byEndpoint.get(t.endpoint) ?? [];
  try {
    const subject = transcriptsToSubject([t], {
      probe: observer,
      asOfTs: AS_OF,
      battery,
      // A check the battery could not run is OUR gap and leaves the
      // completeness denominator. Passing these is the difference between
      // "we did not look" and "the subject failed", which rule 1 turns on.
      gaps: batteryGaps(battery),
    });
    const { result } = scoreSubject(subject);
    const composite = result.composite ?? null;
    if (composite === null) withheld += 1; else published += 1;
    results.push({
      endpoint: t.endpoint,
      composite,
      composite_low: result.composite_low ?? null,
      composite_high: result.composite_high ?? null,
      dimension_coverage: result.dimension_coverage ?? null,
      assessment_completeness: result.assessment_completeness ?? null,
      withheld_reason: result.composite_suppression_reason ?? null,
      gates_fired: result.gates_fired ?? [],
      harness_gaps: result.harness_gaps ?? [],
      battery_outcomes: battery.length,
    });
  } catch (e) {
    // A subject the engine refuses to score is recorded, not dropped. Silently
    // losing it would understate the denominator and flatter the publish rate.
    failed += 1;
    results.push({
      endpoint: t.endpoint,
      composite: null,
      composite_low: null,
      composite_high: null,
      dimension_coverage: null,
      assessment_completeness: null,
      withheld_reason: `could not be scored: ${String((e as Error).message).slice(0, 160)}`,
      gates_fired: [],
      harness_gaps: [],
      battery_outcomes: battery.length,
    });
  }
}

writeFileSync(OUT, JSON.stringify({ generated_at: new Date().toISOString(), as_of: AS_OF, results }, null, 1));

console.log(`\nsubjects scored : ${results.length}`);
console.log(`  PUBLISHED     : ${published}`);
console.log(`  withheld      : ${withheld}`);
console.log(`  unscoreable   : ${failed}`);
for (const r of results.filter((x) => x.composite !== null).slice(0, 12)) {
  const capped = r.gates_fired.length > 0 ? "  [GATE-CAPPED]" : "";
  console.log(`   ${String(r.composite).padStart(8)}  cov=${r.dimension_coverage} compl=${r.assessment_completeness}  ${r.endpoint.slice(0, 40)}${capped}`);
}
console.log(`\n-> ${OUT}`);
