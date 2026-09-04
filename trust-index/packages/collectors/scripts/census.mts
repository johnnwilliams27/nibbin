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
import { writeFileSync } from "node:fs";
import { CAPABILITIES, type CapabilityId } from "../src/capability.js";
import { classifyTools, requiredCapabilities, testability } from "../src/mcp/shape.js";
import { listServers, type RegistryEntry } from "../src/mcp/registry.js";
import { probeMcpServer } from "../src/mcp/probe.js";

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
  const res = await listServers({ remoteOnly: false, maxPages: 400 });

  console.log(`version rows seen:      ${res.rowCount}`);
  console.log(`distinct servers:       ${res.distinctServers}`);
  console.log(`pages fetched:          ${res.pages}${res.truncated ? " (TRUNCATED by page cap)" : ""}`);
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
  const sample = entries.slice(0, limit);
  console.log(`\nPhase 2: reading declarations from ${sample.length} servers. No tool is called.\n`);

  const perCapability = new Map<CapabilityId, Set<string>>();
  let reachable = 0;
  let listedTools = 0;
  let totalTools = 0;
  const shapeCounts = new Map<string, number>();
  const bindingCounts = new Map<string, number>();
  let contradictions = 0;
  let serversFullyTestable = 0;

  for (const e of sample) {
    const endpoint = e.remotes[0]!.url;
    const t = await probeMcpServer(endpoint, e.facts, { attempts: 1, timeoutMs: 10_000 });
    if (t.attempts.some((a) => a.reachable)) reachable += 1;
    if (t.tools?.ok !== true) continue;
    listedTools += 1;
    totalTools += t.tools.declared.length;

    const classified = classifyTools(t.tools.declared);
    for (const c of classified) {
      shapeCounts.set(c.shape, (shapeCounts.get(c.shape) ?? 0) + 1);
      bindingCounts.set(c.binding.kind, (bindingCounts.get(c.binding.kind) ?? 0) + 1);
      contradictions += c.contradictions.length;
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

  console.log(`reachable:            ${reachable} of ${sample.length}`);
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

  console.log(`\nProvisioning queue, ranked by servers unlocked:`);
  console.log(`\n| Capability | Servers it would unlock |`);
  console.log("|---|---|");
  for (const [cap, servers] of [...perCapability].sort((a, b) => b[1].size - a[1].size)) {
    console.log(`| ${cap} | ${servers.size} |`);
  }
}

async function main(): Promise<void> {
  const phase = arg("--phase", "list");
  const entries = await phaseList();
  if (phase === "classify") await phaseClassify(entries);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
