/**
 * Testability census: what fraction of the population can we assess with the
 * sandbox capabilities we hold, and which account would unlock the most.
 *
 * This runs before any battery is built, because building twelve sandbox
 * adapters speculatively is how you end up with three that matter and nine
 * that do not. The census says which three.
 *
 * TWO PHASES, and the split is deliberate.
 *
 *   Phase 1 (--phase list) reads the public registry index. One host,
 *   read-only, ordinary use of an index published for exactly this. No
 *   sign-off needed, and it establishes the population.
 *
 *   Phase 2 (--phase classify) handshakes each server and reads its tool
 *   declarations, which means connecting to thousands of other people's
 *   servers. That is an outward-facing action and is gated behind an explicit
 *   --i-have-approval flag rather than being the default, because the default
 *   should never be the one that touches strangers.
 *
 * Phase 2 still sends no tool call. It reads declarations only.
 *
 * Usage:
 *   pnpm --filter @trust-index/collectors exec tsx scripts/census.mts --phase list
 *   pnpm --filter @trust-index/collectors exec tsx scripts/census.mts --phase classify --i-have-approval
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { CAPABILITIES, type CapabilityId } from "../src/capability.js";
import { handshakeWalled } from "../src/mcp/auth.js";
import { classifyTools, requiredCapabilities, testability } from "../src/mcp/shape.js";
import { listServers, type RegistryEntry } from "../src/mcp/registry.js";
import { probeMcpServer } from "../src/mcp/probe.js";
import type { ProbeTranscript } from "../src/mcp/transcript.js";

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(name);
  return i === -1 ? fallback : (process.argv[i + 1] ?? fallback);
}
const has = (flag: string): boolean => process.argv.includes(flag);

/** What we hold today. Nothing, which is the honest starting point. */
const HELD = new Set<CapabilityId>();

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return "(unparseable)";
  }
}

async function phaseList(): Promise<RegistryEntry[]> {
  console.log("Phase 1: reading the public registry index.\n");
  const res = await listServers({ remoteOnly: false, maxPages: 1500 });

  console.log(`version rows seen:      ${res.rowCount}`);
  console.log(`distinct servers:       ${res.distinctServers}`);
  console.log(`pages fetched:          ${res.pages}${res.truncated ? " (TRUNCATED by page cap)" : ""}`);
  // Refuse to report a population when the listing did not actually parse.
  // Printing a number here that came from a parser defect is exactly how a
  // confident wrong figure gets quoted later.
  if (res.rowCount > 0 && res.distinctServers === 0) {
    console.error("\nABORT: fetched rows but parsed none. This is a parser defect, not an empty registry.");
    for (const f of res.failures) console.error(`  ${f}`);
    process.exit(1);
  }
  if (res.failures.length > 0) {
    // Reported, never swallowed. A partial listing presented as a whole is the
    // error this project has made more than any other.
    console.log(`\nFAILURES (listing is incomplete, do not quote these totals as the population):`);
    for (const f of res.failures) console.log(`  ${f}`);
  }

  const remote = res.entries.filter((e) => e.remotes.length > 0);
  console.log(`\nservers declaring a remote endpoint: ${remote.length} of ${res.entries.length}`);
  console.log(
    `share of distinct servers that are remotely reachable at all: ${((remote.length / Math.max(1, res.distinctServers)) * 100).toFixed(1)}%`,
  );

  const byTransport = new Map<string, number>();
  for (const e of remote) for (const r of e.remotes) byTransport.set(r.type, (byTransport.get(r.type) ?? 0) + 1);
  console.log(`\n| Transport | Endpoints |`);
  console.log("|---|---|");
  for (const [t, n] of [...byTransport].sort((a, b) => b[1] - a[1])) console.log(`| ${t} | ${n} |`);

  const byHost = new Map<string, number>();
  for (const e of remote) for (const r of e.remotes) byHost.set(hostOf(r.url), (byHost.get(hostOf(r.url)) ?? 0) + 1);
  console.log(`\ndistinct endpoint hosts: ${byHost.size}`);
  console.log(`\n| Endpoint host | Servers |`);
  console.log("|---|---|");
  for (const [h, n] of [...byHost].sort((a, b) => b[1] - a[1]).slice(0, 15)) console.log(`| ${h} | ${n} |`);

  const withRepo = remote.filter((e) => e.facts.repository_url !== null).length;
  const withPublish = remote.filter((e) => e.facts.published_at !== null).length;
  console.log(`\nof the ${remote.length} remote servers:`);
  console.log(`  declare a repository:   ${withRepo}`);
  console.log(`  declare a publish date: ${withPublish} (maintenance is unassessable without one)`);

  writeFileSync("census-remote.json", JSON.stringify(remote, null, 2));
  console.log(`\nwrote census-remote.json (${remote.length} entries) for phase 2.`);
  return remote;
}

async function phaseClassify(entries: RegistryEntry[]): Promise<void> {
  if (!has("--i-have-approval")) {
    console.log(
      "\nPhase 2 connects to every listed server to read its tool declarations.\n" +
        "That is an outward-facing action against thousands of third parties.\n" +
        "Re-run with --i-have-approval once that has been agreed.\n",
    );
    return;
  }
  const limit = Number(arg("--limit", "200"));
  const perHostCap = Number(arg("--per-host", "5"));
  const concurrency = Number(arg("--concurrency", "6"));

  // Sample capped per host. A uniform draw would spend 16 percent of the
  // sample on two gateways whose servers share a template, which tests the
  // classifier against one thing repeatedly instead of against the variety it
  // will actually meet. Deterministic order so the run is reproducible.
  const perHost = new Map<string, number>();
  const sample: RegistryEntry[] = [];
  for (const e of entries) {
    if (sample.length >= limit) break;
    if (e.status === "deprecated") continue;
    const h = hostOf(e.remotes[0]!.url);
    const n = perHost.get(h) ?? 0;
    if (n >= perHostCap) continue;
    perHost.set(h, n + 1);
    sample.push(e);
  }
  console.log(
    `\nPhase 2: reading declarations from ${sample.length} servers across ${perHost.size} hosts.\n` +
      `No tool is called. Handshake and tools/list only.\n`,
  );

  const perCapability = new Map<CapabilityId, Set<string>>();
  let reachable = 0;
  let listedTools = 0;
  let totalTools = 0;
  const shapeCounts = new Map<string, number>();
  const bindingCounts = new Map<string, number>();
  let contradictions = 0;
  let serversFullyTestable = 0;

  // Transcripts are persisted. transcript.ts states that a stored transcript
  // can be re-judged under a new rubric without re-probing anyone's server, and
  // the first run of this census did not save them, so 34 contradictions could
  // not be checked for false positives without contacting those servers again.
  const TRANSCRIPT_DIR = arg("--transcripts", "transcripts");
  mkdirSync(TRANSCRIPT_DIR, { recursive: true });
  const safeName = (n: string): string => n.replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 180);

  const failureReasons = new Map<string, number>();
  let authRequired = 0;
  const authHosts = new Set<string>();
  const contradictionKinds = new Map<string, number>();
  const annotationsSeen = { any: 0, readOnly: 0, destructive: 0 };
  const withOutputSchema = { tools: 0 };
  const transcripts: Array<{ name: string; endpoint: string; tools: number }> = [];
  let done = 0;

  let cursor = 0;
  const workers = Array.from({ length: concurrency }, async () => {
    for (;;) {
      const i = cursor++;
      if (i >= sample.length) return;
      const e = sample[i]!;
      const endpoint = e.remotes[0]!.url;
      // Spaced, so 200 servers is a trickle rather than a burst.
      await new Promise((r) => setTimeout(r, 250));
      const t: ProbeTranscript = await probeMcpServer(endpoint, e.facts, { attempts: 1, timeoutMs: 8000 });
      done += 1;
      if (done % 25 === 0) console.error(`  ...${done}/${sample.length}`);
      writeFileSync(`${TRANSCRIPT_DIR}/${safeName(e.facts.name)}.json`, JSON.stringify(t, null, 2));

      const ok = t.attempts.some((a) => a.reachable);
      if (ok) reachable += 1;
      else {
        const why = (t.attempts[0]?.reason ?? "unknown").slice(0, 48);
        failureReasons.set(why, (failureReasons.get(why) ?? 0) + 1);
        continue;
      }
      // Authentication required is OUR missing capability, attributed here at
      // the point of failure. The first run counted these as HTTP 401 failures
      // and they never reached classification, so the largest provisioning
      // need by an order of magnitude was invisible in the provisioning report.
      if (handshakeWalled(t)) {
        authRequired += 1;
        authHosts.add(hostOf(endpoint));
        const set = perCapability.get(CAPABILITIES.mcp_account) ?? new Set<string>();
        set.add(e.facts.name);
        perCapability.set(CAPABILITIES.mcp_account, set);
        continue;
      }
      if (t.handshake?.ok !== true) {
        const why = `handshake: ${(t.handshake?.reason ?? "unknown").slice(0, 40)}`;
        failureReasons.set(why, (failureReasons.get(why) ?? 0) + 1);
        continue;
      }
      if (t.tools?.ok !== true) {
        const why = `tools/list: ${(t.tools?.reason ?? "unknown").slice(0, 40)}`;
        failureReasons.set(why, (failureReasons.get(why) ?? 0) + 1);
        continue;
      }
      listedTools += 1;
      totalTools += t.tools.declared.length;
      transcripts.push({ name: e.facts.name, endpoint, tools: t.tools.declared.length });

      for (const d of t.tools.declared) {
        if (d.outputSchema !== null && d.outputSchema !== undefined) withOutputSchema.tools += 1;
        const a = d.annotations as Record<string, unknown> | null;
        if (a !== null && typeof a === "object") {
          annotationsSeen.any += 1;
          if (a.readOnlyHint === true) annotationsSeen.readOnly += 1;
          if (a.destructiveHint === true) annotationsSeen.destructive += 1;
        }
      }

      const classified = classifyTools(t.tools.declared);
      for (const c of classified) {
        shapeCounts.set(c.shape, (shapeCounts.get(c.shape) ?? 0) + 1);
        const label = c.binding.kind === "read_only" ? `read_only (${c.binding.basis})` : c.binding.kind;
        bindingCounts.set(label, (bindingCounts.get(label) ?? 0) + 1);
        contradictions += c.contradictions.length;
        for (const k of c.contradictions) {
          const kind = k.split("(")[0]!.trim().slice(0, 60);
          contradictionKinds.set(kind, (contradictionKinds.get(kind) ?? 0) + 1);
        }
      }
      const need = requiredCapabilities(classified);
      for (const cap of need) {
        const set = perCapability.get(cap) ?? new Set<string>();
        set.add(e.facts.name);
        perCapability.set(cap, set);
      }
      const score = testability(classified, HELD);
      if (score.blocked === 0) serversFullyTestable += 1;
    }
  });
  await Promise.all(workers);

  console.log(`reachable:            ${reachable} of ${sample.length}`);
  console.log(`answered but required authentication AT THE HANDSHAKE: ${authRequired} across ${authHosts.size} hosts`);
  console.log(`  (a harness gap, not unavailability: those servers are up and declining an anonymous client)`);
  console.log(`  this is the count of servers walled at \`initialize\` and NOT the count of auth-walled servers.`);
  console.log(`  Most MCP servers leave \`initialize\` open and wall \`tools/call\`, often as a JSON-RPC error`);
  console.log(`  inside an HTTP 200. Run scripts/measure-tool-auth.mts for the tool-surface number.`);
  console.log(`listed their tools:   ${listedTools}`);
  console.log(`tools declared:       ${totalTools}`);
  console.log(`declaration contradictions found: ${contradictions}`);
  console.log(`servers fully testable with what we hold today: ${serversFullyTestable} of ${listedTools}`);

  console.log(`\n| Tool shape | Tools |`);
  console.log("|---|---|");
  for (const [s, n] of [...shapeCounts].sort((a, b) => b[1] - a[1])) console.log(`| ${s} | ${n} |`);

  console.log(`\n| Target binding | Tools |`);
  console.log("|---|---|");
  for (const [b, n] of [...bindingCounts].sort((a, b) => b[1] - a[1])) console.log(`| ${b} | ${n} |`);

  console.log(`\n| Annotations and schemas | Tools |`);
  console.log("|---|---|");
  console.log(`| carry any annotations | ${annotationsSeen.any} of ${totalTools} |`);
  console.log(`| declare readOnlyHint true | ${annotationsSeen.readOnly} |`);
  console.log(`| declare destructiveHint true | ${annotationsSeen.destructive} |`);
  console.log(`| declare an outputSchema | ${withOutputSchema.tools} |`);

  if (contradictionKinds.size > 0) {
    console.log(`\n| Declaration contradiction | Tools |`);
    console.log("|---|---|");
    for (const [k, n] of [...contradictionKinds].sort((a, b) => b[1] - a[1])) console.log(`| ${k} | ${n} |`);
  }

  console.log(`\nTop failure reasons:`);
  for (const [r, n] of [...failureReasons].sort((a, b) => b[1] - a[1]).slice(0, 12)) {
    console.log(`  ${String(n).padStart(4)}  ${r}`);
  }

  const toolCounts = transcripts.map((t) => t.tools).sort((a, b) => a - b);
  if (toolCounts.length > 0) {
    const at = (p: number) => toolCounts[Math.min(toolCounts.length - 1, Math.floor(toolCounts.length * p))];
    console.log(`\nTools per server: p25 ${at(0.25)}  p50 ${at(0.5)}  p75 ${at(0.75)}  p90 ${at(0.9)}  max ${toolCounts[toolCounts.length - 1]}`);
  }

  console.log(`\nTranscripts written to ${TRANSCRIPT_DIR}/ so the rubric can be re-run without re-probing.`);

  console.log(`\nProvisioning queue, ranked by servers unlocked:`);
  console.log(`\n| Capability | Servers it would unlock |`);
  console.log("|---|---|");
  for (const [cap, servers] of [...perCapability].sort((a, b) => b[1].size - a[1].size)) {
    console.log(`| ${cap} | ${servers.size} |`);
  }
}

const CACHE = "census-remote.json";

/**
 * Phase 2 reads the cached listing rather than re-paging the registry.
 *
 * Without this a 200-server sample re-fetched all 903 index pages first, which
 * is several minutes of load on someone else's service to rediscover something
 * already on disk. Re-list explicitly with --phase list, or --refresh.
 */
async function loadEntries(): Promise<RegistryEntry[]> {
  if (!has("--refresh") && existsSync(CACHE)) {
    const cached = JSON.parse(readFileSync(CACHE, "utf8")) as RegistryEntry[];
    if (cached.length > 0) {
      console.log(`Using cached listing: ${cached.length} remote servers from ${CACHE}.`);
      console.log("Pass --refresh to re-read the registry index.\n");
      return cached;
    }
    // An empty cache is a failed run's leftovers, not a population. Re-list.
    console.log(`${CACHE} is empty, so it is a failed run's leftovers rather than a population. Re-listing.\n`);
  }
  return phaseList();
}

async function main(): Promise<void> {
  const phase = arg("--phase", "list");
  if (phase === "list") {
    await phaseList();
    return;
  }
  await phaseClassify(await loadEntries());
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
