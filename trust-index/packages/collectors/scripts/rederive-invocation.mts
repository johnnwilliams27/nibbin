/**
 * Recompute invocation verdicts from the stored calls under the fixed rule.
 *
 * The calls are measurement and are never edited; the observations are derived
 * from them and are recomputed when the derivation changes. That separation is
 * why raw responses are stored. Re-probing 161 servers a fourth time in one day
 * to recompute a pure function of data we already hold would put load on people
 * who did not ask for it, to learn nothing.
 *
 * Usage: npx tsx scripts/rederive-invocation.mts --in assessment.json
 */
import { readFileSync, writeFileSync } from "node:fs";
import type { BatteryOutcome } from "../src/mcp/battery.js";
import { diagnoseInvocation } from "../src/mcp/invoke.js";
import { CAPABILITIES } from "../src/capability.js";

const arg = (n: string, d: string): string => {
  const i = process.argv.indexOf(n);
  return i === -1 ? d : (process.argv[i + 1] ?? d);
};
type Row = BatteryOutcome & { server: string; endpoint: string };
const path = arg("--in", "assessment.json");
const rows = JSON.parse(readFileSync(path, "utf8")) as Row[];

const tally = new Map<string, number>();
for (const o of rows) {
  const baseline = o.calls.find((c) => c.label === "baseline");
  if (baseline === undefined) continue;
  const d = diagnoseInvocation(baseline.result);
  tally.set(d.verdict, (tally.get(d.verdict) ?? 0) + 1);

  const key = `invocation_succeeds:${o.tool}`;
  const existing = o.observations.find((x) => x.observation_key === key);
  const ts = existing?.ts ?? o.observations[0]?.ts ?? "2026-09-06T00:00:00Z";
  const ref = existing?.evidence_ref ?? null;
  o.observations = o.observations.filter((x) => x.observation_key !== key);

  const obs = (value: string) => ({
    observer_id: "probe:mcp:v1", dimension: "functional_correctness", provenance: "measured",
    value, ts, observation_key: key, evidence_ref: ref,
  });

  if (d.verdict === "worked") {
    o.observations.unshift(obs("1.000000") as never);
    continue;
  }

  // Not a working call: the battery would have stopped here, so nothing
  // downstream of the baseline is derivable from this outcome.
  o.observations = o.observations.filter((x) => {
    const check = x.observation_key.split(":")[0];
    return check === "response_cost" ? false : !["input_sensitivity", "no_fabrication", "answers_substantively",
      "ignores_embedded_instruction", "any_tool_obeys_embedded_instruction", "rejects_invalid_input",
      "accepts_invalid_input", "no_internal_leakage", "deterministic_for_same_input",
      "honours_output_schema", "reports_errors_via_protocol", "any_tool_fabricates"].includes(check ?? "");
  });

  if (d.verdict === "subject_failed") {
    o.observations.unshift(obs("0.000000") as never);
  } else if (d.verdict === "needs_credentials" || d.verdict === "rate_limited") {
    o.gaps.push({
      dimension: "functional_correctness",
      check: "invocation_succeeds",
      cause: d.verdict === "needs_credentials" ? "harness_capability_missing" : "harness_capability_unhealthy",
      capability: CAPABILITIES.mcp_account,
      detail: d.verdict === "needs_credentials"
        ? `the server requires credentials we do not hold: ${d.detail}`
        : `we called faster than they allow: ${d.detail}`,
    });
  } else {
    o.skipped.push({
      check: "invocation_succeeds",
      reason: d.verdict === "our_arguments"
        ? `our synthesized arguments were rejected: ${d.detail}`
        : `the tool reported an error we cannot attribute: ${d.detail}`,
    });
  }
}

writeFileSync(path, JSON.stringify(rows, null, 2));
console.log(`re-derived ${rows.length} outcomes in ${path}\n`);
for (const [k, v] of [...tally].sort((a, b) => b[1] - a[1])) console.log(`  ${String(v).padStart(4)}  ${k}`);
const theirs = tally.get("subject_failed") ?? 0;
console.log(`\n  genuinely broken: ${theirs}/${rows.length} = ${((theirs / rows.length) * 100).toFixed(1)}%`);
