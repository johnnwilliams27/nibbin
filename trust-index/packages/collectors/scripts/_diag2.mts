import { readFileSync } from "node:fs";
import { join } from "node:path";
import { transcriptToSubject, transcriptsToSubject } from "../src/mcp/subject.js";
import { transcriptGaps } from "../src/mcp/assess.js";
import type { ProbeTranscript } from "../src/mcp/transcript.js";
import { scoreSubject } from "@trust-index/scoring";
const D = join(import.meta.dirname, "..", "transcripts");
const t = JSON.parse(readFileSync(join(D, "ai.advisorsai_service-navigator.json"), "utf8")) as ProbeTranscript;
const asOfTs = "2026-09-05T00:00:00Z";

console.log("== same subject, varying OUR harness age ==");
for (const since of ["2026-04-01T00:00:00Z","2026-01-01T00:00:00Z","2025-09-05T00:00:00Z","2024-09-01T00:00:00Z"]) {
  const probe = { first_seen_ts: since, total_observations: 4000, distinct_subjects: 600, max_observations_single_day: 400 };
  const s = transcriptToSubject(t, { probe, asOfTs, gaps: transcriptGaps(t) });
  const { result } = scoreSubject(s);
  console.log(` probe_since=${since.slice(0,10)} composite=${result.composite} [${result.composite_low},${result.composite_high}] conf=${result.composite_confidence} n_eff(avail)=${result.dimensions[0]!.n_eff}`);
}

console.log("\n== identical transcript replayed on N consecutive days (facts unchanged) ==");
const probe = { first_seen_ts: "2024-09-01T00:00:00Z", total_observations: 4000, distinct_subjects: 600, max_observations_single_day: 400 };
for (const n of [1, 5, 15, 30, 90, 365]) {
  const runs: ProbeTranscript[] = [];
  for (let i = 0; i < n; i++) {
    const day = new Date(Date.parse("2026-09-04T08:00:00Z") - i * 86400000).toISOString().slice(0,19) + "Z";
    runs.push({ ...t, probed_at: day, attempts: t.attempts.map(a => ({...a, ts: day})) });
  }
  const s = transcriptsToSubject(runs, { probe, asOfTs, gaps: transcriptGaps(t) });
  const { result } = scoreSubject(s);
  const dm = Object.fromEntries(result.dimensions.map(d=>[d.dimension, `${d.score}±n${d.n_eff}`]));
  console.log(` days=${String(n).padStart(3)} composite=${result.composite} [${result.composite_low},${result.composite_high}] conf=${result.composite_confidence}`);
  console.log(`      ${result.dimensions.map(d=>`${d.dimension}:n=${d.n_eff} s=${d.score} tier=${d.coverage_tier}`).join("  ")}`);
}
