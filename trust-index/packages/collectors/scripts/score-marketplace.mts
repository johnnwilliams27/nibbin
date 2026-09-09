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
 * BOTH PROTOCOLS. MCP transcripts score under `mcp_server.v2` and A2A
 * transcripts under `a2a_agent.v1`. They are scored in one pass on purpose:
 * the site publishes one index, and running the two protocols through separate
 * scripts is how the A2A half stayed at zero published while the MCP half
 * worked. The profiles are built to be comparable — same behaviour/declaration
 * split, same coverage and completeness floors — so an A2A 70 means roughly
 * what an MCP 70 means.
 *
 * Usage:
 *   pnpm exec tsx scripts/score-marketplace.mts \
 *     --transcripts trial-transcripts --battery assess-outcomes.json \
 *     --a2a-battery a2a-battery.json --out scored-endpoints.json
 */
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { scoreSubject } from "@trust-index/scoring";
import { transcriptsToSubject, batteryGaps } from "../src/mcp/subject.js";
import { probeSeed } from "../src/mcp/probe-identity.js";
import type { ProbeTranscript } from "../src/mcp/transcript.js";
import type { BatteryOutcome } from "../src/mcp/battery.js";
import { a2aToSubject } from "../src/a2a/subject.js";
import type { A2aBatteryResult } from "../src/a2a/battery.js";
import type { A2aTranscript } from "../src/a2a/transcript.js";

const argv = process.argv.slice(2);
const arg = (n: string, d: string): string => {
  const i = argv.indexOf(n);
  return i === -1 ? d : (argv[i + 1] ?? d);
};

const DIR = arg("--transcripts", "transcripts");
const BATTERY = arg("--battery", "");
const A2A_BATTERY = arg("--a2a-battery", "");
const OUT = arg("--out", "scored-endpoints.json");
/**
 * Second precision, not milliseconds. The engine rejects a sub-second
 * timestamp outright — observation identity is observer + dimension + key + ts,
 * and a millisecond clock would make two runs of the same check incomparable
 * where they should collide. `toISOString()` gives milliseconds, so it is
 * truncated here rather than at fourteen call sites downstream.
 */
const AS_OF = arg("--as-of", new Date().toISOString().replace(/\.\d{3}Z$/, "Z"));

// `probeSeed()` returns { seed, reproducible } and never null, so the guard
// this replaces — `if (seed === null)` — was dead code: a run with no seed
// configured passed it silently and produced ratings nobody could replay. It is
// the reproducibility flag that carries the information, and scoring reads no
// probe values itself, so an unset seed is reported rather than fatal.
if (!probeSeed().reproducible) {
  console.warn(
    "TRUST_INDEX_PROBE_SEED is not set: the transcripts being scored were produced with an ephemeral seed and cannot be replayed.",
  );
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

/**
 * A2A battery results, keyed by the endpoint they were run against.
 *
 * One result per agent rather than one per skill: `runA2aBattery` already
 * carries every skill's outcome and every skill it refused, and splitting them
 * would lose the refusals — which are the half that must reach the rating as
 * our gap.
 */
const a2aByEndpoint = new Map<string, A2aBatteryResult>();
if (A2A_BATTERY !== "" && existsSync(A2A_BATTERY)) {
  const doc = JSON.parse(readFileSync(A2A_BATTERY, "utf8")) as { results?: A2aBatteryResult[] };
  for (const r of doc.results ?? []) {
    if (typeof r.endpoint === "string" && r.endpoint !== "") a2aByEndpoint.set(r.endpoint, r);
  }
  console.log(`A2A battery results for ${a2aByEndpoint.size} endpoints`);
}

type Scored = {
  endpoint: string;
  /** Which profile produced this row. Two protocols, two rubrics, one index. */
  protocol: "mcp" | "a2a";
  composite: number | null;
  composite_low: number | null;
  composite_high: number | null;
  /** Both axes, kept separate. Coverage is how much we looked; it is never merged into the score. */
  dimension_coverage: number | null;
  assessment_completeness: number | null;
  /**
   * The engine's own coverage tier — DEPTH — as the weakest tier across the
   * dimensions that published.
   *
   * `dimension_coverage` is BREADTH: how much of the profile produced a score.
   * A subject probed once can have breadth 1.0, because one run touches every
   * arm. It cannot have depth: `strong_min_span_days` exists so that tier is
   * unreachable in a day, and the engine duly returns `thin` for every
   * dimension of a single-day subject.
   *
   * Both are needed downstream. The marketplace shows one three-step "Coverage"
   * axis whose `strong` copy reads "we exercised the full probe set... few
   * blind spots", and mapping breadth alone onto it labels a subject we looked
   * at exactly once as strongly covered. The weakest tier is the honest bound,
   * and the consumer takes the lower of the two.
   */
  evidence_tier: "none" | "thin" | "moderate" | "strong" | null;
  /** The engine's own words for why no number published. Never blank. */
  withheld_reason: string | null;
  gates_fired: unknown[];
  /** Checks that did not run because WE could not run them. They left the denominator. */
  harness_gaps: unknown[];
  battery_outcomes: number;
};


/**
 * The weakest coverage tier among the dimensions that actually published.
 *
 * Weakest, not average and not the heaviest dimension's: this value bounds a
 * claim about how well we looked, and a chain of evidence is no stronger than
 * its thinnest link. A subject with five strong dimensions and one thin one has
 * a thin spot, and saying so costs us nothing we are entitled to.
 */
function evidenceTier(
  dimensions: ReadonlyArray<{ score: number | null; coverage_tier: string }>,
): Scored["evidence_tier"] {
  const ORDER = ["none", "thin", "moderate", "strong"] as const;
  let worst = ORDER.length - 1;
  let seen = false;
  for (const d of dimensions) {
    if (d.score === null) continue;
    seen = true;
    const i = ORDER.indexOf(d.coverage_tier as (typeof ORDER)[number]);
    if (i >= 0 && i < worst) worst = i;
  }
  return seen ? ORDER[worst]! : null;
}

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
const loadedA2a: A2aTranscript[] = [];
for (const f of files) {
  let t: unknown;
  try {
    t = JSON.parse(readFileSync(join(DIR, f), "utf8"));
  } catch {
    continue; // a malformed transcript is not a subject
  }
  // Discriminated by SHAPE, not by filename. An MCP transcript carries
  // `endpoint`; an A2A one carries `subject_url` and a `discovery` tier. Both
  // land in the same directory and the two must not be read as each other —
  // casting an A2A transcript to ProbeTranscript yields a subject with no
  // endpoint, which silently drops it from the denominator.
  const rec = t as Partial<ProbeTranscript> & Partial<A2aTranscript>;
  if (typeof rec.endpoint === "string" && rec.endpoint !== "") {
    loaded.push(rec as ProbeTranscript);
  } else if (typeof rec.subject_url === "string" && rec.discovery !== undefined) {
    loadedA2a.push(rec as A2aTranscript);
  }
}
for (const t of loaded) observationCount += (byEndpoint.get(t.endpoint) ?? []).length;
for (const r of a2aByEndpoint.values()) observationCount += r.skills.length;

const observer = {
  first_seen_ts: process.env["PROBE_SINCE"] ?? "2024-09-01T00:00:00Z",
  total_observations: Math.max(1, observationCount),
  distinct_subjects: Math.max(1, loaded.length + loadedA2a.length),
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
      protocol: "mcp",
      composite,
      composite_low: result.composite_low ?? null,
      composite_high: result.composite_high ?? null,
      dimension_coverage: result.dimension_coverage ?? null,
      assessment_completeness: result.assessment_completeness ?? null,
      evidence_tier: evidenceTier(result.dimensions ?? []),
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
      protocol: "mcp",
      composite: null,
      composite_low: null,
      composite_high: null,
      dimension_coverage: null,
      assessment_completeness: null,
      evidence_tier: null,
      withheld_reason: `could not be scored: ${String((e as Error).message).slice(0, 160)}`,
      gates_fired: [],
      harness_gaps: [],
      battery_outcomes: battery.length,
    });
  }
}

/**
 * The A2A half, under `a2a_agent.v1`.
 *
 * The endpoint a battery result is keyed by is the card's declared INTERFACE,
 * which is frequently not the URL the card itself was fetched from — see
 * a2a/probe.ts. Resolving it the same way `run-a2a-battery.mts` does is what
 * makes the join land; matching on `subject_url` would silently find nothing
 * and every A2A agent would come out unrated with a battery that had run.
 */
function a2aEndpoint(t: A2aTranscript): string | null {
  if (t.reachability?.url != null && t.reachability.url !== "") return t.reachability.url;
  const declared = t.declaration?.interfaces[0]?.url;
  return typeof declared === "string" && declared !== "" ? declared : null;
}

for (const t of loadedA2a) {
  const endpoint = a2aEndpoint(t) ?? t.subject_url;
  const battery = a2aByEndpoint.get(endpoint) ?? null;
  try {
    const subject = a2aToSubject(t, {
      probe: observer,
      asOfTs: AS_OF,
      battery,
      tags: ["a2a"],
    });
    const { result } = scoreSubject(subject);
    const composite = result.composite ?? null;
    if (composite === null) withheld += 1; else published += 1;
    results.push({
      endpoint,
      protocol: "a2a",
      composite,
      composite_low: result.composite_low ?? null,
      composite_high: result.composite_high ?? null,
      dimension_coverage: result.dimension_coverage ?? null,
      assessment_completeness: result.assessment_completeness ?? null,
      evidence_tier: evidenceTier(result.dimensions ?? []),
      withheld_reason: result.composite_suppression_reason ?? null,
      gates_fired: result.gates_fired ?? [],
      harness_gaps: result.harness_gaps ?? [],
      battery_outcomes: battery?.skills.length ?? 0,
    });
  } catch (e) {
    failed += 1;
    results.push({
      endpoint,
      protocol: "a2a",
      composite: null,
      composite_low: null,
      composite_high: null,
      dimension_coverage: null,
      assessment_completeness: null,
      evidence_tier: null,
      withheld_reason: `could not be scored: ${String((e as Error).message).slice(0, 160)}`,
      gates_fired: [],
      harness_gaps: [],
      battery_outcomes: battery?.skills.length ?? 0,
    });
  }
}

writeFileSync(OUT, JSON.stringify({ generated_at: new Date().toISOString(), as_of: AS_OF, results }, null, 1));

const rate = (p: "mcp" | "a2a"): string => {
  const rows = results.filter((r) => r.protocol === p);
  const pub = rows.filter((r) => r.composite !== null).length;
  return rows.length === 0 ? "none" : `${pub}/${rows.length}`;
};

console.log(`\nsubjects scored : ${results.length}`);
console.log(`  PUBLISHED     : ${published}   (mcp ${rate("mcp")}, a2a ${rate("a2a")})`);
console.log(`  withheld      : ${withheld}`);
console.log(`  unscoreable   : ${failed}`);
for (const r of results.filter((x) => x.composite !== null).sort((a, b) => (b.composite ?? 0) - (a.composite ?? 0)).slice(0, 20)) {
  const capped = r.gates_fired.length > 0 ? "  [GATE-CAPPED]" : "";
  console.log(`   ${String(r.composite).padStart(8)}  ${r.protocol}  cov=${r.dimension_coverage} compl=${r.assessment_completeness}  ${r.endpoint.slice(0, 40)}${capped}`);
}
console.log(`\n-> ${OUT}`);
