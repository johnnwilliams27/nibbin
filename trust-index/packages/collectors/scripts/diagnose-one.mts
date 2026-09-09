import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { transcriptToSubject, batteryGaps } from "../src/mcp/subject.js";
import { transcriptGaps } from "../src/mcp/assess.js";
import type { BatteryOutcome } from "../src/mcp/battery.js";
import type { ProbeTranscript } from "../src/mcp/transcript.js";
import { scoreSubject } from "@trust-index/scoring";
const ROOT = join(import.meta.dirname, "..");
const raw = JSON.parse(readFileSync(join(ROOT, "assessment.json"), "utf8")) as (BatteryOutcome & { server?: string; endpoint?: string })[];
const byServer = new Map<string, BatteryOutcome[]>();
for (const o of raw) byServer.set(o.endpoint ?? "?", [...(byServer.get(o.endpoint ?? "?") ?? []), o]);
const probe = { first_seen_ts: "2024-09-01T00:00:00Z", total_observations: 4000, distinct_subjects: 600, max_observations_single_day: 400 };
const asOfTs = `${new Date().toISOString().slice(0, 19)}Z`;
let shown = 0;
for (const f of readdirSync(join(ROOT, "transcripts"))) {
  const t = JSON.parse(readFileSync(join(ROOT, "transcripts", f), "utf8")) as ProbeTranscript;
  const name = t.registry?.name ?? t.endpoint;
  const b = byServer.get(t.endpoint);
  if (b === undefined) continue;
  const s = transcriptToSubject(t, { probe, asOfTs, gaps: [...transcriptGaps(t), ...batteryGaps(b)], battery: b });
  const { result } = scoreSubject(s);
  console.log(`${name}  battery tools=${b.length}  observations=${s.observations.length}  gaps=${s.gaps.length}`);
  console.log(`  coverage=${result.dimension_coverage} completeness=${result.assessment_completeness} composite=${result.composite}`);
  for (const d of result.dimensions) {
    console.log(`   ${d.dimension.padEnd(24)} obs=${String(d.observation_count).padStart(3)} n_eff=${String(d.n_eff).padStart(5)} score=${String(d.score).padStart(6)} ${d.suppression_reason ?? ""}`);
  }
  if (++shown >= 2) break;
  console.log("");
}
