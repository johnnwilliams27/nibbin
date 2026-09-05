import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { transcriptToSubject } from "../src/mcp/subject.js";
import { transcriptGaps } from "../src/mcp/assess.js";
import type { ProbeTranscript } from "../src/mcp/transcript.js";
import { scoreSubject } from "@trust-index/scoring";
const D = join(import.meta.dirname, "..", "transcripts");
const probe = { first_seen_ts: "2024-09-01T00:00:00Z", total_observations: 4000, distinct_subjects: 600, max_observations_single_day: 400 };
const asOfTs = "2026-09-05T00:00:00Z";
const s: number[] = []; const iv: [number,number][] = [];
for (const f of readdirSync(D)) {
  const t = JSON.parse(readFileSync(join(D, f), "utf8")) as ProbeTranscript;
  try { const r = scoreSubject(transcriptToSubject(t, { probe, asOfTs, gaps: transcriptGaps(t) })).result;
    if (r.composite === null) continue; s.push(r.composite); iv.push([r.composite_low!, r.composite_high!]); } catch {}
}
let ge5 = 0, ge10 = 0, disjoint = 0, tot = 0;
for (let i=0;i<s.length;i++) for (let j=i+1;j<s.length;j++) {
  tot++; const d = Math.abs(s[i]!-s[j]!);
  if (d>=5) ge5++; if (d>=10) ge10++;
  if (iv[i]![1] < iv[j]![0] || iv[j]![1] < iv[i]![0]) disjoint++;
}
console.log(`pairs: ${tot}`);
console.log(`pairs >= 5 pts apart (project's own safe-comparison margin): ${ge5} (${(ge5/tot*100).toFixed(2)}%)`);
console.log(`pairs >=10 pts apart: ${ge10} (${(ge10/tot*100).toFixed(2)}%)`);
console.log(`pairs with disjoint 95% intervals: ${disjoint} (${(disjoint/tot*100).toFixed(2)}%)`);
