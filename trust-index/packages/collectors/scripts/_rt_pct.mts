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
const asOfTs = "2026-09-05T12:00:00Z";
const xs: number[] = [];
for (const f of readdirSync(join(ROOT, "transcripts"))) {
  const t = JSON.parse(readFileSync(join(ROOT, "transcripts", f), "utf8")) as ProbeTranscript;
  const b = byEp.get(t.endpoint); if (!b) continue;
  try { const s = transcriptToSubject(t, { probe, asOfTs, gaps: [...transcriptGaps(t), ...batteryGaps(b)], battery: b });
    const { result } = scoreSubject(s); if (result.composite !== null) xs.push(result.composite); } catch {}
}
xs.sort((a, b) => a - b);
const pct = (v: number) => (100 * xs.filter((x) => x < v).length) / xs.length;
console.log(`n=${xs.length} min=${xs[0]} max=${xs.at(-1)}`);
for (const v of [52.95, 57.95, 62.95, 70.45, 75.33, 75.45, 45.0]) console.log(`  score ${String(v).padStart(6)} -> percentile ${pct(v).toFixed(0)}`);
