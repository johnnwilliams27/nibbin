import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { transcriptToSubject, batteryGaps } from "../src/mcp/subject.js";
import { transcriptGaps } from "../src/mcp/assess.js";
import type { BatteryOutcome } from "../src/mcp/battery.js";
import type { ProbeTranscript } from "../src/mcp/transcript.js";
import { scoreSubject } from "@trust-index/scoring";
const ROOT = join(import.meta.dirname, "..");
const raw = JSON.parse(readFileSync(join(ROOT, "assessment.json"), "utf8")) as (BatteryOutcome & { endpoint?: string })[];
const byEp = new Map<string, BatteryOutcome[]>();
for (const o of raw) byEp.set(o.endpoint ?? "?", [...(byEp.get(o.endpoint ?? "?") ?? []), o]);
const probe = { first_seen_ts: "2024-09-01T00:00:00Z", total_observations: 4000, distinct_subjects: 600, max_observations_single_day: 400 };
const asOfTs = `${new Date().toISOString().slice(0, 19)}Z`;
const xs: number[] = [];
for (const f of readdirSync(join(ROOT, "transcripts"))) {
  const t = JSON.parse(readFileSync(join(ROOT, "transcripts", f), "utf8")) as ProbeTranscript;
  const b = byEp.get(t.endpoint);
  if (b === undefined) continue;
  try {
    const s = transcriptToSubject(t, { probe, asOfTs, gaps: [...transcriptGaps(t), ...batteryGaps(b)], battery: b });
    const { result } = scoreSubject(s);
    if (result.composite !== null) xs.push(result.composite);
  } catch { /* skip */ }
}
xs.sort((a, b) => a - b);
const q = (p: number) => xs[Math.min(xs.length - 1, Math.floor(xs.length * p))]!;
console.log(`subjects with behavioural evidence and a published rating: ${xs.length}`);
console.log(`min=${xs[0]!.toFixed(1)} p10=${q(0.1).toFixed(1)} p50=${q(0.5).toFixed(1)} p90=${q(0.9).toFixed(1)} max=${xs.at(-1)!.toFixed(1)}`);
console.log(`p10-p90 spread=${(q(0.9) - q(0.1)).toFixed(1)}   distinct integers=${new Set(xs.map((x) => Math.round(x))).size}`);
console.log("");
console.log("for comparison, manifest-only under v1: p10=59.3 p50=61.1 p90=61.7 spread=2.4 distinct=8");
