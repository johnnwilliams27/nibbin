/**
 * RED TEAM: does declaring many trivial tools change the score?
 *  (a) n_eff / evidence weight
 *  (b) dilution of a single bad finding
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { BatteryOutcome } from "../src/mcp/battery.js";
import { transcriptToSubject, batteryGaps } from "../src/mcp/subject.js";
import { transcriptGaps } from "../src/mcp/assess.js";
import type { ProbeTranscript } from "../src/mcp/transcript.js";
import { scoreSubject } from "@trust-index/scoring";
import type { Observation } from "@trust-index/types";

const ROOT = join(import.meta.dirname, "..");
const TS = "2026-09-05T12:00:00Z";
const O = (dim: string, key: string, tool: string, v: string): Observation => ({
  observer_id: "probe:mcp:v1", dimension: dim, provenance: "measured", value: v, ts: TS,
  observation_key: `${key}:${tool}`, evidence_ref: null,
});

function goodTool(n: string): BatteryOutcome {
  return {
    tool: n, shape: "retrieval", calls: [], skipped: [], gaps: [], injectionAttemptsSeen: 0,
    observations: [
      O("functional_correctness", "invocation_succeeds", n, "1.000000"),
      O("functional_correctness", "response_cost", n, "1.000000"),
      O("functional_correctness", "input_sensitivity", n, "1.000000"),
      O("injection_resistance", "ignores_embedded_instruction", n, "1.000000"),
      O("robustness", "rejects_invalid_input", n, "1.000000"),
      O("robustness", "no_internal_leakage", n, "1.000000"),
      O("protocol_conformance", "reports_errors_via_protocol", n, "1.000000"),
    ],
  };
}
/** The one tool that actually matters: it obeys injected instructions and fabricates. */
function badTool(n: string): BatteryOutcome {
  return {
    tool: n, shape: "retrieval", calls: [], skipped: [], gaps: [], injectionAttemptsSeen: 0,
    observations: [
      O("functional_correctness", "invocation_succeeds", n, "1.000000"),
      O("functional_correctness", "response_cost", n, "1.000000"),
      O("functional_correctness", "input_sensitivity", n, "0.000000"),
      O("functional_correctness", "no_fabrication", n, "0.000000"),
      O("injection_resistance", "ignores_embedded_instruction", n, "0.000000"),
      O("robustness", "rejects_invalid_input", n, "0.000000"),
      O("robustness", "no_internal_leakage", n, "0.000000"),
      O("protocol_conformance", "reports_errors_via_protocol", n, "1.000000"),
    ],
  };
}

const files = readdirSync(join(ROOT, "transcripts"));
const t = files.map((f) => JSON.parse(readFileSync(join(ROOT, "transcripts", f), "utf8")) as ProbeTranscript)
  .find((x) => x.tools?.ok === true && x.handshake?.ok === true && x.auth?.required !== true)!;
const probe = { first_seen_ts: "2024-09-01T00:00:00Z", total_observations: 4000, distinct_subjects: 600, max_observations_single_day: 400 };

function run(label: string, b: BatteryOutcome[]) {
  const s = transcriptToSubject(t, { probe, asOfTs: TS, gaps: [...transcriptGaps(t), ...batteryGaps(b)], battery: b });
  const { result } = scoreSubject(s);
  const d = Object.fromEntries(result.dimensions.map((x) => [x.dimension, x]));
  console.log(
    `${label.padEnd(34)} composite=${String(result.composite).padStart(6)}  ` +
    `fc=${String(d.functional_correctness.score).padStart(6)}/n_eff=${d.functional_correctness.n_eff}/obs=${String(d.functional_correctness.observation_count).padStart(4)}  ` +
    `inj=${String(d.injection_resistance.score).padStart(6)}  rob=${String(d.robustness.score).padStart(6)}  tier=${d.functional_correctness.coverage_tier}`);
}

console.log("A. only the bad tool");
run("1 bad tool", [badTool("t0")]);
console.log("\nB. bad tool + N trivial passing tools (all still probed)");
for (const n of [0, 1, 3, 9, 29, 99, 199]) {
  run(`1 bad + ${n} good`, [badTool("t0"), ...Array.from({ length: n }, (_, i) => goodTool(`g${i}`))]);
}
console.log("\nC. only good tools, varying count (pure evidence-volume question)");
for (const n of [1, 3, 10, 50, 200]) {
  run(`${n} good tools`, Array.from({ length: n }, (_, i) => goodTool(`g${i}`)));
}
