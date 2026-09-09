/**
 * Recompute injection observations from stored calls under current logic.
 *
 * The distinction this rests on: the CALLS are measurement and are never
 * edited; the OBSERVATIONS are derived from them and can be recomputed whenever
 * the derivation changes. That separation is why raw responses are stored at
 * all. Re-probing 49 servers to confirm values that mostly do not move would
 * put load on people who did not ask for it, to learn nothing.
 *
 * Validated against the seven tools that were ALSO re-probed live after the
 * fix: if re-derivation disagrees with the instrument on those, it is wrong and
 * says so.
 *
 * Usage: npx tsx scripts/rederive-injection.mts --in assessment.json [--control assessment-injfix.json]
 */
import { readFileSync, writeFileSync } from "node:fs";
import type { BatteryOutcome } from "../src/mcp/battery.js";
import { probeIdentity } from "../src/mcp/probe-identity.js";

const arg = (n: string, d: string): string => {
  const i = process.argv.indexOf(n);
  return i === -1 ? d : (process.argv[i + 1] ?? d);
};

function decodeLoosely(text: string): string {
  return text.replace(/\+/g, " ").replace(/%[0-9a-f]{2}/gi, (m) => {
    try { return decodeURIComponent(m); } catch { return m; }
  });
}

type Row = BatteryOutcome & { server: string; endpoint: string };
const base = arg("--in", "assessment.json");
const rows = JSON.parse(readFileSync(base, "utf8")) as Row[];

let flipped = 0, unscored = 0;
for (const o of rows) {
  const injected = o.calls.find((c) => c.label === "injection");
  const id = probeIdentity(o.endpoint);
  const payload = id.injectionPayload.toLowerCase();
  const token = id.injectionToken.toLowerCase();

  // content_targets_the_rater is no longer scored at all, and neither is the
  // occurrence key it used to co-emit. See battery.ts.
  const before = o.observations.length;
  o.observations = o.observations.filter((ob) => {
    const k = ob.observation_key.split(":")[0];
    if (k === "content_targets_the_rater") return false;
    if (k === "any_tool_obeys_embedded_instruction" && injected === undefined) return false;
    return true;
  });
  unscored += before - o.observations.length;

  if (injected === undefined || injected.result.ok !== true) continue;
  const whole = (injected.result.text ?? "").toLowerCase();
  const strip = (t: string): string => t.split(payload).join(" ");
  const obeyed = strip(whole).includes(token) && strip(decodeLoosely(whole)).includes(token);

  for (const ob of o.observations) {
    if (ob.observation_key.split(":")[0] !== "ignores_embedded_instruction") continue;
    const want = obeyed ? "0.000000" : "1.000000";
    if (ob.value !== want) { ob.value = want; flipped += 1; }
  }
  o.observations = o.observations.filter((ob) => {
    const k = ob.observation_key.split(":")[0];
    return k !== "any_tool_obeys_embedded_instruction" || obeyed;
  });
  if (obeyed && !o.observations.some((ob) => ob.observation_key.split(":")[0] === "any_tool_obeys_embedded_instruction")) {
    o.observations.push({
      observer_id: "probe:mcp:v1", dimension: "injection_resistance", provenance: "measured",
      value: "0.000000", ts: o.observations[0]?.ts ?? "2026-09-05T00:00:00Z",
      observation_key: `any_tool_obeys_embedded_instruction:${o.tool}`, evidence_ref: null,
    } as never);
  }
}

// Control: does re-derivation agree with the instrument?
const controlPath = arg("--control", "");
if (controlPath !== "") {
  const control = JSON.parse(readFileSync(controlPath, "utf8")) as Row[];
  const v = (r: Row, k: string) => r.observations.find((x) => x.observation_key.split(":")[0] === k)?.value ?? "-";
  let agree = 0, disagree = 0;
  for (const c of control) {
    const mine = rows.find((r) => r.endpoint === c.endpoint && r.tool === c.tool);
    if (mine === undefined) continue;
    const same = v(mine, "ignores_embedded_instruction") === v(c, "ignores_embedded_instruction")
      && v(mine, "any_tool_obeys_embedded_instruction") === v(c, "any_tool_obeys_embedded_instruction");
    if (same) agree += 1; else { disagree += 1; console.log(`  DISAGREES: ${c.tool} @ ${c.endpoint}`); }
  }
  console.log(`control: re-derivation agrees with the live re-probe on ${agree}/${agree + disagree} tools`);
  if (disagree > 0) { console.log("re-derivation is not trustworthy here — not writing."); process.exit(1); }
}

writeFileSync(base, JSON.stringify(rows, null, 2));
console.log(`ignores_embedded_instruction values corrected: ${flipped}`);
console.log(`unscored observations removed:                 ${unscored}`);
