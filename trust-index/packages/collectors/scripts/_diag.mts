import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { transcriptToSubject } from "/home/user/nibbin/trust-index/packages/collectors/src/mcp/subject.js";
import { transcriptGaps } from "/home/user/nibbin/trust-index/packages/collectors/src/mcp/assess.js";
import type { ProbeTranscript } from "/home/user/nibbin/trust-index/packages/collectors/src/mcp/transcript.js";
import { scoreSubject } from "@trust-index/scoring";
const D = "/home/user/nibbin/trust-index/packages/collectors/transcripts";
const probe = { first_seen_ts: "2024-09-01T00:00:00Z", total_observations: 4000, distinct_subjects: 600, max_observations_single_day: 400 };
const asOfTs = `${new Date().toISOString().slice(0, 19)}Z`;
const dimStats = new Map<string, {n:number[], raw:number[], score:number[], pub:number, tot:number}>();
let obsW: number[] = [];
const rows: any[] = [];
for (const f of readdirSync(D)) {
  const t = JSON.parse(readFileSync(join(D, f), "utf8")) as ProbeTranscript;
  try {
    const s = transcriptToSubject(t, { probe, asOfTs, gaps: transcriptGaps(t) });
    const { result } = scoreSubject(s);
    for (const w of result.observer_weights) obsW.push(w.weight);
    for (const d of result.dimensions) {
      let e = dimStats.get(d.dimension);
      if (!e) { e = {n:[],raw:[],score:[],pub:0,tot:0}; dimStats.set(d.dimension, e); }
      e.tot++; e.n.push(d.n_eff);
      if (d.score !== null) { e.pub++; e.score.push(d.score); }
    }
    if (result.composite !== null) rows.push({id: result.subject_id, c: result.composite, lo: result.composite_low, hi: result.composite_high, conf: result.composite_confidence, dims: result.dimensions.filter(d=>d.score!==null).map(d=>`${d.dimension}=${d.score}/n${d.n_eff}`).join(" ")});
  } catch (e) { }
}
const q=(a:number[],p:number)=>{const b=[...a].sort((x,y)=>x-y);return b[Math.min(b.length-1,Math.floor(b.length*p))]!;};
console.log("observer weights p10/p50/p90:", q(obsW,.1), q(obsW,.5), q(obsW,.9));
for (const [k,v] of dimStats) {
  console.log(`${k.padEnd(22)} pub=${String(v.pub).padStart(3)}/${v.tot}  n_eff p10/50/90=${q(v.n,.1)}/${q(v.n,.5)}/${q(v.n,.9)}  score p10/50/90=${v.score.length?`${q(v.score,.1)}/${q(v.score,.5)}/${q(v.score,.9)}`:"-"}  scoremin/max=${v.score.length?`${Math.min(...v.score)}/${Math.max(...v.score)}`:"-"}`);
}
console.log("\nsample rows:");
for (const r of rows.slice(0,10)) console.log(` ${String(r.c).padStart(5)} [${r.lo},${r.hi}] conf=${r.conf} ${r.dims}`);
