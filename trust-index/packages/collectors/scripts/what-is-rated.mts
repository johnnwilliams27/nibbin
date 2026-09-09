import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { transcriptToSubject } from "../src/mcp/subject.js";
import { transcriptGaps } from "../src/mcp/assess.js";
import type { ProbeTranscript } from "../src/mcp/transcript.js";
const D = join(import.meta.dirname, "..", "transcripts");
const probe = { first_seen_ts: "2024-09-01T00:00:00Z", total_observations: 4000, distinct_subjects: 600, max_observations_single_day: 400 };
const asOfTs = `${new Date().toISOString().slice(0, 19)}Z`;
const keys = new Set<string>();
for (const f of readdirSync(D)) {
  try {
    const t = JSON.parse(readFileSync(join(D, f), "utf8")) as ProbeTranscript;
    const s = transcriptToSubject(t, { probe, asOfTs, gaps: transcriptGaps(t) });
    for (const o of s.observations) keys.add(o.observation_key.split(":")[0]!);
  } catch { /* skip */ }
}
console.log("checks that reach a published rating:");
for (const k of [...keys].sort()) console.log("   ", k);
