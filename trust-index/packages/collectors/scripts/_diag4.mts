import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { assessTranscript, transcriptGaps } from "../src/mcp/assess.js";
import type { ProbeTranscript } from "../src/mcp/transcript.js";
import { RATING_PROFILES } from "@trust-index/types";
const D = join(import.meta.dirname, "..", "transcripts");
const asOfTs = "2026-09-05T00:00:00Z";
const prof = RATING_PROFILES["mcp_server.v1"]!;
const W = new Map(prof.dimensions.map(d=>[d.id, Number(d.weight)]));
const raws: number[] = [];
for (const f of readdirSync(D)) {
  const t = JSON.parse(readFileSync(join(D, f), "utf8")) as ProbeTranscript;
  let obs; try { obs = assessTranscript(t, asOfTs); } catch { continue; }
  const g = transcriptGaps(t);
  if (g.some(x=>x.cause.startsWith("harness"))) continue;
  const byDim = new Map<string, number[]>();
  for (const o of obs) { const a = byDim.get(o.dimension) ?? []; a.push(Number(o.value)); byDim.set(o.dimension, a); }
  let num=0, den=0;
  for (const [d, vals] of byDim) { const w = W.get(d)!; num += w * (vals.reduce((x,y)=>x+y,0)/vals.length); den += w; }
  if (den < 0.6) continue;
  raws.push(100*num/den);
}
raws.sort((a,b)=>a-b);
const q=(p:number)=>raws[Math.min(raws.length-1,Math.floor(raws.length*p))]!;
console.log("subjects:", raws.length);
console.log("RAW (no shrinkage, no prior) weighted-mean composite:");
console.log(" min/p10/p25/p50/p75/p90/max:", [0,.1,.25,.5,.75,.9].map(p=>q(p).toFixed(1)).join(" / "), "/", raws.at(-1)!.toFixed(1));
console.log(" p10-p90 spread:", (q(.9)-q(.1)).toFixed(1), " distinct ints:", new Set(raws.map(Math.round)).size);
