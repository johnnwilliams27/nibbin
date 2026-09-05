/** RED TEAM 5: does the gaming payoff grow with probe cadence? */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { BatteryOutcome } from "../src/mcp/battery.js";
import { transcriptsToSubject, batteryGaps } from "../src/mcp/subject.js";
import { transcriptGaps } from "../src/mcp/assess.js";
import type { ProbeTranscript } from "../src/mcp/transcript.js";
import { scoreSubject } from "@trust-index/scoring";
import type { Observation } from "@trust-index/types";

const ROOT = join(import.meta.dirname, "..");
const base = readdirSync(join(ROOT, "transcripts"))
  .map((f) => JSON.parse(readFileSync(join(ROOT, "transcripts", f), "utf8")) as ProbeTranscript)
  .find((x) => x.tools?.ok === true && x.handshake?.ok === true && x.auth?.required !== true)!;
const probe = { first_seen_ts: "2024-09-01T00:00:00Z", total_observations: 4000, distinct_subjects: 600, max_observations_single_day: 400 };
const END = Date.parse("2026-09-05T00:00:00Z");

function O(dim: string, key: string, v: string, ts: string): Observation {
  return { observer_id: base.probe_id, dimension: dim, provenance: "measured", value: v, ts, observation_key: `${key}:st`, evidence_ref: null };
}
function outcome(v: string, ts: string): BatteryOutcome {
  return { tool: "st", shape: "retrieval", calls: [], skipped: [], gaps: [], injectionAttemptsSeen: 0, observations: [
    O("functional_correctness", "invocation_succeeds", v, ts), O("functional_correctness", "response_cost", v, ts),
    O("functional_correctness", "input_sensitivity", v, ts), O("injection_resistance", "ignores_embedded_instruction", v, ts),
    O("robustness", "rejects_invalid_input", v, ts), O("robustness", "no_internal_leakage", v, ts),
    O("protocol_conformance", "reports_errors_via_protocol", v, ts) ] };
}

for (const days of [1, 7, 30, 90, 365]) {
  const line: string[] = [];
  for (const [label, v] of [["honest-fail", "0.000000"], ["gamed-pass", "1.000000"]] as const) {
    const ts: string[] = [], copies: ProbeTranscript[] = [], b: BatteryOutcome[] = [];
    for (let i = 0; i < days; i += 1) {
      const d = new Date(END - i * 86400_000).toISOString().slice(0, 19) + "Z";
      ts.push(d);
      copies.push({ ...base, probed_at: d, attempts: base.attempts.map((a) => ({ ...a, ts: d })) });
      b.push(outcome(v, d));
    }
    const asOfTs = "2026-09-05T12:00:00Z";
    const s = transcriptsToSubject(copies, { probe, asOfTs, gaps: [...transcriptGaps(base), ...batteryGaps(b)], battery: b });
    const { result } = scoreSubject(s);
    const d = Object.fromEntries(result.dimensions.map((x) => [x.dimension, x]));
    line.push(`${label}: composite=${String(result.composite).padStart(6)} fc=${String(d.functional_correctness.score).padStart(6)} n_eff=${String(d.functional_correctness.n_eff).padStart(5)} conf=${result.composite_confidence} tier=${d.functional_correctness.coverage_tier}`);
  }
  console.log(`days=${String(days).padStart(3)}  ${line.join("   |   ")}`);
}
