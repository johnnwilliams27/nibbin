/**
 * What does the evidence say with the constants taken out of the way?
 *
 * DIAGNOSTIC, NOT A PROPOSAL. Nothing here is a scoring change. The published
 * pipeline is unchanged; this reads the same observations and reports what they
 * contain before a prior and a shrinkage constant are applied to them.
 *
 * The reason to look: with n_eff capped at ~1 per dimension and k = 5, every
 * measured dimension is algebraically confined to [45.96, 62.40] whatever the
 * evidence says, and the prior (0.55) sits far below the population's own
 * evidence mean (~0.93), so it drags every subject down rather than
 * regularising it. Under those conditions the published number is mostly a
 * statement about two constants. This asks what is underneath.
 *
 * Four views, each stricter than the last about what counts as a real check:
 *   A  all checks, profile weights, no prior, no shrinkage
 *   B  drop checks with zero variance across the population
 *   C  drop near-constant checks too (sd < 0.05)
 *   D  B, with dimension weights set by observed discriminative power
 *
 * D is included to show the ceiling, and should be read with suspicion:
 * weighting dimensions by how much they happen to separate THIS population is
 * fitting the sample. It is a diagnostic upper bound, not a design.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { transcriptToSubject } from "../src/mcp/subject.js";
import { transcriptGaps } from "../src/mcp/assess.js";
import type { ProbeTranscript } from "../src/mcp/transcript.js";
import { getRatingProfile } from "@trust-index/types";
import { scoreSubject } from "@trust-index/scoring";

const D = join(import.meta.dirname, "..", "transcripts");
const probe = { first_seen_ts: "2024-09-01T00:00:00Z", total_observations: 4000, distinct_subjects: 600, max_observations_single_day: 400 };
const asOfTs = `${new Date().toISOString().slice(0, 19)}Z`;

type Row = { server: string; byDim: Map<string, number[]>; byCheck: Map<string, number>; publishable: boolean };
const rows: Row[] = [];
const checkDim = new Map<string, string>();
for (const f of readdirSync(D)) {
  let t: ProbeTranscript;
  try { t = JSON.parse(readFileSync(join(D, f), "utf8")) as ProbeTranscript; } catch { continue; }
  let s;
  try { s = transcriptToSubject(t, { probe, asOfTs, gaps: transcriptGaps(t) }); } catch { continue; }
  if (s.observations.length === 0) continue;
  const byDim = new Map<string, number[]>();
  const byCheck = new Map<string, number>();
  for (const o of s.observations) {
    const v = Number(o.value);
    if (!Number.isFinite(v)) continue;
    byDim.set(o.dimension, [...(byDim.get(o.dimension) ?? []), v]);
    const key = o.observation_key.split(":")[0]!;
    byCheck.set(key, v);
    checkDim.set(key, o.dimension);
  }
  // Whether TODAY's pipeline would publish this subject. The comparison has to
  // be like for like: including the 300 we withhold — mostly HTTP 401 servers
  // with one or two observations — would widen the spread with subjects nobody
  // would ever see a rating for, and flatter the diagnostic.
  let publishable = false;
  try { publishable = scoreSubject(s).result.composite !== null; } catch { publishable = false; }
  rows.push({ server: t.registry?.name ?? f, byDim, byCheck, publishable });
}

// Which checks carry information, measured over the population?
const checkVals = new Map<string, number[]>();
for (const r of rows) for (const [k, v] of r.byCheck) checkVals.set(k, [...(checkVals.get(k) ?? []), v]);
const sd = (vs: number[]) => {
  const m = vs.reduce((a, b) => a + b, 0) / vs.length;
  return Math.sqrt(vs.reduce((a, b) => a + (b - m) ** 2, 0) / vs.length);
};
const checkSd = new Map([...checkVals].map(([k, vs]) => [k, sd(vs)]));
const dead = [...checkSd].filter(([, s]) => s === 0).map(([k]) => k);
const nearDead = [...checkSd].filter(([, s]) => s > 0 && s < 0.05).map(([k]) => k);

const WEIGHTS = new Map(getRatingProfile("mcp_server.v1").dimensions.map((d) => [d.id, Number(d.weight)]));

function composite(r: Row, drop: Set<string>, weights: Map<string, number>): number | null {
  let num = 0, den = 0;
  for (const [dim, w] of weights) {
    const vals: number[] = [];
    for (const [k, v] of r.byCheck) if (checkDim.get(k) === dim && !drop.has(k)) vals.push(v);
    if (vals.length === 0) continue;
    num += w * (vals.reduce((a, b) => a + b, 0) / vals.length);
    den += w;
  }
  return den === 0 ? null : (num / den) * 100;
}

const report = (label: string, drop: Set<string>, weights: Map<string, number>, onlyPublishable = false) => {
  const xs = rows.filter((r) => !onlyPublishable || r.publishable)
    .map((r) => composite(r, drop, weights)).filter((x): x is number => x !== null).sort((a, b) => a - b);
  const q = (p: number) => xs[Math.min(xs.length - 1, Math.floor(xs.length * p))]!;
  const distinct = new Set(xs.map((x) => Math.round(x))).size;
  console.log(
    label.padEnd(46),
    `n=${String(xs.length).padStart(3)}`,
    `p10=${q(0.1).toFixed(1).padStart(5)}`,
    `p50=${q(0.5).toFixed(1).padStart(5)}`,
    `p90=${q(0.9).toFixed(1).padStart(5)}`,
    `spread=${(q(0.9) - q(0.1)).toFixed(1).padStart(5)}`,
    `distinct=${String(distinct).padStart(3)}`,
  );
};

console.log(`subjects with evidence: ${rows.length}`);
console.log(`checks with zero variance (measure nothing): ${dead.length} — ${dead.join(", ")}`);
console.log(`checks with sd < 0.05 (near-constant):       ${nearDead.length} — ${nearDead.join(", ")}`);
console.log("");
console.log("PUBLISHED TODAY (prior 0.55, k=5, n_eff~1):    p10=59.3 p50=61.1 p90=61.7 spread=2.4 distinct=8");
console.log("");
report("A  all checks, profile weights", new Set(), WEIGHTS);
report("B  drop zero-variance checks", new Set(dead), WEIGHTS);
report("C  drop near-constant checks too", new Set([...dead, ...nearDead]), WEIGHTS);

const discriminative = new Map<string, number>();
for (const [dim] of WEIGHTS) {
  const vs = rows.map((r) => {
    const a: number[] = [];
    for (const [k, v] of r.byCheck) if (checkDim.get(k) === dim && !dead.includes(k)) a.push(v);
    return a.length === 0 ? null : a.reduce((x, y) => x + y, 0) / a.length;
  }).filter((x): x is number => x !== null);
  discriminative.set(dim, vs.length === 0 ? 0 : sd(vs));
}
const totalSd = [...discriminative.values()].reduce((a, b) => a + b, 0);
const byPower = new Map([...discriminative].map(([d, s]) => [d, totalSd === 0 ? 0 : s / totalSd]));
report("D  drop dead + weight by discriminative power", new Set(dead), byPower);
console.log("");
console.log("SAME, restricted to the 300 subjects today's pipeline actually publishes:");
report("A' all checks, profile weights", new Set(), WEIGHTS, true);
report("B' drop zero-variance checks", new Set(dead), WEIGHTS, true);
report("D' drop dead + weight by power", new Set(dead), byPower, true);
console.log("");
console.log("dimension weights, declared vs observed discriminative power:");
for (const [d, w] of WEIGHTS) {
  console.log(`  ${d.padEnd(24)} declared=${w.toFixed(2)}   sd=${(discriminative.get(d) ?? 0).toFixed(3)}   power-weight=${(byPower.get(d) ?? 0).toFixed(2)}`);
}
