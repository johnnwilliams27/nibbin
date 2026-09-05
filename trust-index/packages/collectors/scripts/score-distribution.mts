import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { transcriptToSubject } from "../src/mcp/subject.js";
import { transcriptGaps } from "../src/mcp/assess.js";
import type { ProbeTranscript } from "../src/mcp/transcript.js";
import { scoreSubject } from "@trust-index/scoring";
const D = join(import.meta.dirname, "..", "transcripts");
const probe = { first_seen_ts: "2024-09-01T00:00:00Z", total_observations: 4000, distinct_subjects: 600, max_observations_single_day: 400 };
const asOfTs = `${new Date().toISOString().slice(0, 19)}Z`;
const scores: number[] = []; const widths: number[] = [];
for (const f of readdirSync(D)) {
  const t = JSON.parse(readFileSync(join(D, f), "utf8")) as ProbeTranscript;
  try {
    const s = transcriptToSubject(t, { probe, asOfTs, gaps: transcriptGaps(t) });
    const { result } = scoreSubject(s);
    if (result.composite === null) continue;
    scores.push(result.composite);
    if (result.composite_high !== null && result.composite_low !== null) widths.push(result.composite_high - result.composite_low);
  } catch { /* counted elsewhere */ }
}
scores.sort((a, b) => a - b); widths.sort((a, b) => a - b);
const q = (a: number[], p: number) => a[Math.min(a.length - 1, Math.floor(a.length * p))]!;
console.log("published:", scores.length);
console.log("score  min/p10/p25/p50/p75/p90/max:",
  [0, .1, .25, .5, .75, .9].map((p) => q(scores, p).toFixed(1)).join(" / "), "/", scores.at(-1)!.toFixed(1));
console.log("interval width p50:", q(widths, .5).toFixed(1), " p90:", q(widths, .9).toFixed(1));
const uniq = new Set(scores.map((s) => Math.round(s))).size;
console.log("distinct integer scores:", uniq, "of", scores.length, "ratings");
const within2 = scores.filter((s) => Math.abs(s - q(scores, .5)) <= 2).length;
console.log("within +/-2 points of the median:", within2, `(${((within2 / scores.length) * 100).toFixed(0)}%)`);
console.log("");
console.log("Does the interval separate anyone? A rating only distinguishes two servers");
console.log("when their intervals do not overlap.");
const medW = q(widths, .5);
console.log(`median interval width ${medW.toFixed(1)} points vs a p10-p90 score spread of ${(q(scores,.9)-q(scores,.1)).toFixed(1)} points`);
