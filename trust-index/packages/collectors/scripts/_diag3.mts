import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { assessTranscript } from "../src/mcp/assess.js";
import type { ProbeTranscript } from "../src/mcp/transcript.js";
const D = join(import.meta.dirname, "..", "transcripts");
const asOfTs = "2026-09-05T00:00:00Z";
const byKey = new Map<string, number[]>();
for (const f of readdirSync(D)) {
  const t = JSON.parse(readFileSync(join(D, f), "utf8")) as ProbeTranscript;
  let obs; try { obs = assessTranscript(t, asOfTs); } catch { continue; }
  for (const o of obs) {
    const k = o.observation_key.startsWith("availability:") ? "availability:*" : `${o.dimension}/${o.observation_key}`;
    const a = byKey.get(k) ?? []; a.push(Number(o.value)); byKey.set(k, a);
  }
}
const q=(a:number[],p:number)=>a[Math.min(a.length-1,Math.floor(a.length*p))]!;
console.log("check".padEnd(50), "n".padStart(5), "mean".padStart(6), "p10".padStart(6), "p50".padStart(6), "p90".padStart(6), " frac==1", " frac==0");
for (const [k,v] of [...byKey].sort()) {
  const s=[...v].sort((a,b)=>a-b);
  const mean=v.reduce((x,y)=>x+y,0)/v.length;
  console.log(k.padEnd(50), String(v.length).padStart(5), mean.toFixed(3).padStart(6), q(s,.1).toFixed(2).padStart(6), q(s,.5).toFixed(2).padStart(6), q(s,.9).toFixed(2).padStart(6),
    ` ${(v.filter(x=>x>=1).length/v.length*100).toFixed(0)}%`.padStart(8), ` ${(v.filter(x=>x<=0).length/v.length*100).toFixed(0)}%`.padStart(8));
}
