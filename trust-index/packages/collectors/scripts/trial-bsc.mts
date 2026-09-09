/**
 * Trial run: probe a slice of the BSC targets and write transcripts, so
 * assess.mts can run the real battery over them.
 *
 * This exists to settle one unmeasured question. The site publishes zero
 * scores, and there are two incompatible explanations: either the battery was
 * never run against these subjects (the marketplace pipeline hardcodes
 * `composite: null`), or the rubric is calibrated so nothing can clear
 * completeness >= 0.60. Those demand opposite responses -- run the battery, or
 * recalibrate -- and guessing between them is how a threshold gets lowered for
 * the wrong reason.
 *
 * So: probe a small slice, run the real battery, count what publishes. No
 * thresholds are touched here and none should be until this has an answer.
 *
 * Usage:
 *   pnpm exec tsx scripts/trial-bsc.mts --targets battery-targets.json \
 *     --out trial-transcripts --mcp 12 --a2a 12
 */
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { probeMcpServer } from "../src/mcp/probe.js";
import { probeA2aAgent } from "../src/a2a/probe.js";

const argv = process.argv.slice(2);
const arg = (n: string, d: string): string => {
  const i = argv.indexOf(n);
  return i === -1 ? d : (argv[i + 1] ?? d);
};

const TARGETS = arg("--targets", "battery-targets.json");
const OUT = arg("--out", "trial-transcripts");
const N_MCP = Number(arg("--mcp", "12"));
const N_A2A = Number(arg("--a2a", "12"));
/**
 * How many endpoints to take from ONE host. Default 1, because the usual job is
 * to learn the publication rate across DIFFERENT services and twelve endpoints
 * on one backend would measure one server twelve times.
 *
 * Raise it when a host genuinely carries distinct agents rather than one
 * service behind many paths — api.orbit-agents.com/a2a/<name> is eight agents,
 * not eight views of one. It is still a sample: never set it high enough to
 * exhaust a host.
 */
const PER_HOST = Number(arg("--per-host", "1"));

type Target = { url: string; host: string; protocols: string[]; registrations: number };
const doc = JSON.parse(readFileSync(TARGETS, "utf8")) as {
  shared_backends: Array<{ host: string }>;
  targets: Target[];
};

const shared = new Set(doc.shared_backends.map((s) => s.host));

/**
 * Up to PER_HOST targets per host, default one.
 *
 * The point of a trial is to learn the publication rate across DIFFERENT
 * services, and twelve endpoints on one backend would measure one server twelve
 * times and say nothing about the population. Hosts named in
 * `shared_backends` are excluded outright for the same reason.
 */
function pick(protocol: string, n: number): Target[] {
  const perHost = new Map<string, number>();
  const out: Target[] = [];
  for (const t of doc.targets) {
    if (out.length >= n) break;
    if (!t.protocols.includes(protocol)) continue;
    if (shared.has(t.host)) continue;
    const used = perHost.get(t.host) ?? 0;
    if (used >= PER_HOST) continue;
    perHost.set(t.host, used + 1);
    out.push(t);
  }
  return out;
}

const mcp = pick("mcp", N_MCP);
const a2a = pick("a2a", N_A2A);
console.log(
  `trial: ${mcp.length} MCP + ${a2a.length} A2A, ` +
    `up to ${PER_HOST} per host, none on a shared backend\n`,
);

mkdirSync(OUT, { recursive: true });
const safe = (u: string): string => u.replace(/[^a-z0-9]+/gi, "_").slice(0, 90);

let mcpOk = 0, a2aOk = 0;

await Promise.all(
  mcp.map(async (t) => {
    try {
      const tr = await probeMcpServer(t.url, null, { timeoutMs: 15_000 });
      writeFileSync(join(OUT, `mcp_${safe(t.url)}.json`), JSON.stringify(tr, null, 1));
      // `declared`, not `tools`. The first version of this line read
      // `tr.tools?.tools`, which is always undefined, so every server reported
      // zero tools -- and four servers that had completed a handshake looked
      // like they exposed nothing. One of them declares 57 tools. That would
      // have been written up as "MCP servers on BSC expose no tools", i.e. our
      // field-name error published as a fact about the population, which is the
      // exact failure this project exists to prevent.
      const tools = tr.tools?.declared?.length ?? 0;
      if (tr.handshake?.ok === true) mcpOk += 1;
      console.log(`  MCP  ${tr.handshake?.ok === true ? "handshake OK" : "no handshake"}  tools=${tools}  ${t.url.slice(0, 58)}`);
    } catch (e) {
      console.log(`  MCP  threw: ${String((e as Error).message).slice(0, 50)}  ${t.url.slice(0, 48)}`);
    }
  }),
);

await Promise.all(
  a2a.map(async (t) => {
    try {
      const tr = await probeA2aAgent(t.url, { timeoutMs: 15_000 });
      writeFileSync(join(OUT, `a2a_${safe(t.url)}.json`), JSON.stringify(tr, null, 1));
      const outcome = tr.discovery?.outcome ?? "?";
      const skills = tr.declaration?.skills?.length ?? 0;
      if (outcome === "card") a2aOk += 1;
      console.log(`  A2A  ${outcome}  skills=${skills}  ${t.url.slice(0, 58)}`);
    } catch (e) {
      console.log(`  A2A  threw: ${String((e as Error).message).slice(0, 50)}  ${t.url.slice(0, 48)}`);
    }
  }),
);

console.log(`\nMCP handshakes: ${mcpOk}/${mcp.length}   A2A cards: ${a2aOk}/${a2a.length}`);
console.log(`transcripts -> ${OUT}`);
