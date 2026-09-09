/**
 * Explode `endpoint-probes.json` into the transcript directory the batteries
 * and the scorer read.
 *
 * The pipeline has a join missing in the middle. `probe-marketplace.mts` writes
 * ONE bundle containing every endpoint's transcripts inline; `assess.mts`,
 * `run-a2a-battery.mts` and `score-marketplace.mts` all read a DIRECTORY of
 * per-subject transcript files. `transcripts-to-probes.mts` goes one way and
 * nothing went the other, so an automated refresh could probe the population
 * and then have nothing to hand the battery. This is that step.
 *
 * Filenames match what `trial-bsc.mts` writes, because the downstream scripts
 * discriminate MCP from A2A partly by prefix and a run that mixed conventions
 * would silently score half the population.
 *
 * Usage:
 *   pnpm exec tsx scripts/probes-to-transcripts.mts \
 *     [--probes ../../apps/bnb-marketplace/data/probes/endpoint-probes.json] \
 *     [--out transcripts]
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { ProbeTranscript } from "../src/mcp/transcript.js";
import type { A2aTranscript } from "../src/a2a/transcript.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const arg = (n: string, d: string): string => {
  const i = process.argv.indexOf(n);
  return i === -1 ? d : (process.argv[i + 1] ?? d);
};

const PROBES = resolve(
  arg("--probes", join(HERE, "../../../apps/bnb-marketplace/data/probes/endpoint-probes.json")),
);
const OUT = resolve(arg("--out", "transcripts"));

type EndpointResult = {
  endpoint: string;
  mcp: ProbeTranscript | null;
  a2a: A2aTranscript | null;
};

const doc = JSON.parse(readFileSync(PROBES, "utf8")) as { results: EndpointResult[] };
mkdirSync(OUT, { recursive: true });

/** Same slug rule as trial-bsc.mts, so a rerun overwrites rather than accumulating. */
const safe = (u: string): string => u.replace(/[^a-z0-9]+/gi, "_").slice(0, 90);

let mcp = 0;
let a2a = 0;
let empty = 0;
for (const r of doc.results) {
  if (r.mcp !== null && r.mcp !== undefined) {
    writeFileSync(join(OUT, `mcp_${safe(r.endpoint)}.json`), JSON.stringify(r.mcp, null, 1));
    mcp += 1;
  }
  if (r.a2a !== null && r.a2a !== undefined) {
    writeFileSync(join(OUT, `a2a_${safe(r.endpoint)}.json`), JSON.stringify(r.a2a, null, 1));
    a2a += 1;
  }
  // An endpoint with neither transcript was in the target list and produced no
  // reading at all. Counted, because a silent drop here would shrink the
  // denominator of everything downstream without anyone noticing.
  if ((r.mcp === null || r.mcp === undefined) && (r.a2a === null || r.a2a === undefined)) empty += 1;
}

console.log(`${doc.results.length} probed endpoints -> ${mcp} MCP + ${a2a} A2A transcripts`);
if (empty > 0) console.log(`${empty} endpoints produced no transcript of either kind`);
console.log(`-> ${OUT}`);
