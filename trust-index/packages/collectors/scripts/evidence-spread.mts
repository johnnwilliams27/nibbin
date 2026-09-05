/**
 * Is the flatness in the evidence, or in the estimator?
 *
 * The published ratings span 2.4 points across 300 servers. That has exactly
 * two possible causes and they call for opposite responses:
 *
 *   (a) the raw observations already differ between servers, and shrinkage
 *       against a dominant prior is collapsing them — more evidence per
 *       subject fixes it, and the design is sound;
 *   (b) the raw observations are themselves nearly identical, because the
 *       checks do not discriminate — more runs of the same checks change
 *       nothing at all, and the checks are the thing to fix.
 *
 * This looks at the observation values BEFORE they reach the estimator, so the
 * answer does not depend on any constant.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { transcriptToSubject } from "../src/mcp/subject.js";
import { transcriptGaps } from "../src/mcp/assess.js";
import type { ProbeTranscript } from "../src/mcp/transcript.js";

const D = join(import.meta.dirname, "..", "transcripts");
const probe = { first_seen_ts: "2024-09-01T00:00:00Z", total_observations: 4000, distinct_subjects: 600, max_observations_single_day: 400 };
const asOfTs = `${new Date().toISOString().slice(0, 19)}Z`;

/** dimension -> mean raw value per subject */
const byDim = new Map<string, number[]>();
/** observation_key -> values, to see which individual checks vary */
const byCheck = new Map<string, number[]>();

for (const f of readdirSync(D)) {
  let t: ProbeTranscript;
  try { t = JSON.parse(readFileSync(join(D, f), "utf8")) as ProbeTranscript; } catch { continue; }
  let s;
  try { s = transcriptToSubject(t, { probe, asOfTs, gaps: transcriptGaps(t) }); } catch { continue; }
  if (s.observations.length === 0) continue;
  const perDim = new Map<string, number[]>();
  for (const o of s.observations) {
    const v = Number(o.value);
    if (!Number.isFinite(v)) continue;
    perDim.set(o.dimension, [...(perDim.get(o.dimension) ?? []), v]);
    const key = o.observation_key.split(":")[0]!;
    byCheck.set(key, [...(byCheck.get(key) ?? []), v]);
  }
  for (const [d, vs] of perDim) {
    byDim.set(d, [...(byDim.get(d) ?? []), vs.reduce((a, b) => a + b, 0) / vs.length]);
  }
}

const stats = (vs: number[]) => {
  const a = [...vs].sort((x, y) => x - y);
  const mean = a.reduce((x, y) => x + y, 0) / a.length;
  const sd = Math.sqrt(a.reduce((x, y) => x + (y - mean) ** 2, 0) / a.length);
  const q = (p: number) => a[Math.min(a.length - 1, Math.floor(a.length * p))]!;
  return { n: a.length, mean, sd, p10: q(0.1), p50: q(0.5), p90: q(0.9), distinct: new Set(a.map((v) => v.toFixed(3))).size };
};

console.log("RAW EVIDENCE PER DIMENSION (mean observation value per subject, before the estimator)");
console.log("dimension".padEnd(24), "n".padStart(5), "mean".padStart(7), "sd".padStart(7), "p10".padStart(7), "p50".padStart(7), "p90".padStart(7), "distinct".padStart(9));
for (const [d, vs] of [...byDim].sort()) {
  const s = stats(vs);
  console.log(d.padEnd(24), String(s.n).padStart(5), s.mean.toFixed(3).padStart(7), s.sd.toFixed(3).padStart(7),
    s.p10.toFixed(3).padStart(7), s.p50.toFixed(3).padStart(7), s.p90.toFixed(3).padStart(7), String(s.distinct).padStart(9));
}

console.log("");
console.log("PER CHECK — which individual checks actually separate servers?");
console.log("check".padEnd(34), "n".padStart(5), "mean".padStart(7), "sd".padStart(7), "distinct".padStart(9));
for (const [k, vs] of [...byCheck].sort((a, b) => stats(b[1]).sd - stats(a[1]).sd)) {
  const s = stats(vs);
  console.log(k.slice(0, 33).padEnd(34), String(s.n).padStart(5), s.mean.toFixed(3).padStart(7), s.sd.toFixed(3).padStart(7), String(s.distinct).padStart(9));
}
