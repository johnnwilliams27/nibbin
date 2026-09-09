/**
 * Rebuild the marketplace's `endpoint-probes.json` from a transcript directory.
 *
 * The site's probe file was the output of one old sweep: 111 endpoints, all
 * A2A, no MCP transcripts at all. Every score the pipeline now produces comes
 * from MCP subjects that file has never heard of, so a merge against it lands
 * three of nine. The fix is not to special-case the merge, it is to stop the
 * site reading a stale snapshot.
 *
 * `agent_count` is the fan-out — how many ERC-8004 registrations point at this
 * endpoint — read from the battery target list. It is carried because one
 * endpoint standing for 3,909 registrations and one standing for a single agent
 * are different facts, and a merge that treated them alike would spread one
 * server's assessment across thousands of rows without saying so.
 *
 * Usage:
 *   pnpm exec tsx scripts/transcripts-to-probes.mts \
 *     --transcripts full-transcripts --targets battery-targets.json --out probes.json
 */
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const argv = process.argv.slice(2);
const arg = (n: string, d: string): string => {
  const i = argv.indexOf(n);
  return i === -1 ? d : (argv[i + 1] ?? d);
};

const DIR = arg("--transcripts", "transcripts");
const TARGETS = arg("--targets", "");
const OUT = arg("--out", "endpoint-probes.json");

/** endpoint -> registrations pointing at it, and the protocols it declares. */
const meta = new Map<string, { agent_count: number; protocols: string[] }>();
if (TARGETS !== "") {
  const t = JSON.parse(readFileSync(TARGETS, "utf8")) as {
    targets: Array<{ url: string; protocols: string[]; registrations: number }>;
  };
  for (const x of t.targets) {
    meta.set(x.url, { agent_count: x.registrations, protocols: x.protocols.map((p) => p.toUpperCase()) });
  }
}

type Row = {
  endpoint: string;
  host: string;
  protocols: string[];
  priority: number;
  agent_count: number;
  mcp: unknown;
  a2a: unknown;
  probed_at: string;
};

/** One row per endpoint, carrying whichever transcripts exist for it. */
const rows = new Map<string, Row>();

for (const f of readdirSync(DIR).filter((x) => x.endsWith(".json"))) {
  let t: Record<string, unknown>;
  try {
    t = JSON.parse(readFileSync(join(DIR, f), "utf8")) as Record<string, unknown>;
  } catch {
    continue;
  }
  const isMcp = f.startsWith("mcp_");
  // An MCP transcript names its endpoint; an A2A transcript names the URL it
  // discovered the card at, which is the address a client would dial.
  const endpoint =
    (t["endpoint"] as string | undefined) ??
    ((t["discovery"] as { url?: string } | undefined)?.url) ??
    ((t["subject_url"] as string | undefined));
  if (typeof endpoint !== "string" || endpoint === "") continue;

  let host = "";
  try { host = new URL(endpoint).host; } catch { /* leave blank rather than drop the row */ }

  const m = meta.get(endpoint);
  const existing = rows.get(endpoint);
  const row: Row = existing ?? {
    endpoint,
    host,
    protocols: m?.protocols ?? (isMcp ? ["MCP"] : ["A2A"]),
    priority: 0,
    agent_count: m?.agent_count ?? 1,
    mcp: null,
    a2a: null,
    probed_at: (t["probed_at"] as string | undefined) ?? new Date().toISOString(),
  };
  if (isMcp) row.mcp = t;
  else row.a2a = t;
  rows.set(endpoint, row);
}

const out = [...rows.values()].sort((a, b) => b.agent_count - a.agent_count);
writeFileSync(OUT, JSON.stringify({ generated_at: new Date().toISOString(), results: out }, null, 1));

const withMcp = out.filter((r) => r.mcp !== null).length;
const withA2a = out.filter((r) => r.a2a !== null).length;
console.log(`${out.length} endpoints  (mcp transcripts: ${withMcp}, a2a transcripts: ${withA2a})`);
console.log(`registrations they stand for: ${out.reduce((s, r) => s + r.agent_count, 0).toLocaleString()}`);
console.log(`-> ${OUT}`);
