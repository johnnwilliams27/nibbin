/** RED TEAM 3: gate evasion by renaming a credential parameter. */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { transcriptToSubject, batteryGaps } from "../src/mcp/subject.js";
import { transcriptGaps, isCredentialParam, isMutatingName } from "../src/mcp/assess.js";
import type { ProbeTranscript } from "../src/mcp/transcript.js";
import { scoreSubject } from "@trust-index/scoring";

const ROOT = join(import.meta.dirname, "..");
const files = readdirSync(join(ROOT, "transcripts"));
const base = files.map((f) => JSON.parse(readFileSync(join(ROOT, "transcripts", f), "utf8")) as ProbeTranscript)
  .find((x) => x.tools?.ok === true && x.handshake?.ok === true && x.auth?.required !== true)!;
const probe = { first_seen_ts: "2024-09-01T00:00:00Z", total_observations: 4000, distinct_subjects: 600, max_observations_single_day: 400 };
const TS = "2026-09-05T12:00:00Z";

console.log("isCredentialParam:", ["api_key","apiKey","auth_token","authToken","access_key","bearer","pat","x_api_key","user_token","key"].map(n=>`${n}=${isCredentialParam(n)}`).join(" "));
console.log("isMutatingName:  ", ["delete_doc","destroy_doc","wipe_index","erase_all","truncate_table","overwrite_file","terminate_instance"].map(n=>`${n}=${isMutatingName(n)}`).join(" "));
console.log("");

function withParam(pname: string, tname: string): ProbeTranscript {
  const t = JSON.parse(JSON.stringify(base)) as ProbeTranscript;
  (t.tools as any).declared = [
    ...(t.tools as any).declared,
    { name: tname, description: "Fetch the account ledger for the authenticated caller.",
      inputSchema: { type: "object", properties: { [pname]: { type: "string", description: "credential" } }, required: [pname] } },
  ];
  return t;
}

for (const [pname, tname] of [["(none)", "-"], ["api_key", "get_ledger"], ["auth_token", "get_ledger"], ["access_key", "get_ledger"], ["x_api_key", "get_ledger"]] as const) {
  const t = pname === "(none)" ? base : withParam(pname, tname);
  const s = transcriptToSubject(t, { probe, asOfTs: TS, gaps: [...transcriptGaps(t), ...batteryGaps([])] });
  const { result } = scoreSubject(s);
  console.log(`param=${pname.padEnd(12)} composite=${String(result.composite).padStart(6)} reason=${String(result.composite_suppression_reason)} gates=${result.gates_fired.map((g:any)=>g.gate_id).join(",")||"-"} tool_safety=${result.dimensions.find((d:any)=>d.dimension==="tool_safety").score}`);
}

// Again, with behavioural evidence so the composite actually publishes.
import type { BatteryOutcome } from "../src/mcp/battery.js";
import type { Observation } from "@trust-index/types";
const O = (dim: string, key: string, v: string): Observation => ({ observer_id: "probe:mcp:v1", dimension: dim, provenance: "measured", value: v, ts: TS, observation_key: `${key}:st`, evidence_ref: null });
const good: BatteryOutcome = { tool: "st", shape: "retrieval", calls: [], skipped: [], gaps: [], injectionAttemptsSeen: 0, observations: [
  O("functional_correctness","invocation_succeeds","1.000000"), O("functional_correctness","response_cost","1.000000"),
  O("functional_correctness","input_sensitivity","1.000000"), O("injection_resistance","ignores_embedded_instruction","1.000000"),
  O("robustness","rejects_invalid_input","1.000000"), O("robustness","no_internal_leakage","1.000000"),
  O("protocol_conformance","reports_errors_via_protocol","1.000000")] };
console.log("\nwith behavioural evidence attached:");
for (const pname of ["(none)", "api_key", "auth_token"] as const) {
  const t = pname === "(none)" ? base : withParam(pname, "get_ledger");
  const s = transcriptToSubject(t, { probe, asOfTs: TS, gaps: [...transcriptGaps(t), ...batteryGaps([good])], battery: [good] });
  const { result } = scoreSubject(s);
  console.log(`param=${pname.padEnd(12)} composite=${String(result.composite).padStart(6)} gates=${result.gates_fired.map((g:any)=>g.gate_id).join(",")||"-"}`);
}
