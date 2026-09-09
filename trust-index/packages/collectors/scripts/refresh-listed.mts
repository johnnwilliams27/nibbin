/** Explicitly bounded listed-interface refresh. No skills, tools, payments or installs. */
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { probeMcpInterface } from "../src/mcp/interface.js";
import { probeA2aAgent } from "../src/a2a/probe.js";
import { probeIdentity } from "../src/mcp/probe-identity.js";
import type { EndpointResult } from "./merge-marketplace-assessments.mjs";

type Agent = { agent_id: string; name: string; category: string; endpoint: string | null;
  protocols: string[]; is_reference_agent: boolean };
export type RefreshTarget = { endpoint: string; host: string; protocols: string[]; agent_ids: string[]; name: string };

export function planListedRefresh(agents: Agent[]): RefreshTarget[] {
  const categories = new Set(["rebalancing", "yield", "grid_trading", "health_factor"]);
  const targets = new Map<string, RefreshTarget>();
  for (const agent of agents) {
    if (agent.is_reference_agent || !categories.has(agent.category) || typeof agent.endpoint !== "string" || !agent.endpoint.trim()) continue;
    const endpoint = agent.endpoint.trim();
    let host = "invalid-url";
    try { host = new URL(endpoint).hostname; } catch { /* recorded as unmeasured by the guard */ }
    const target = targets.get(endpoint) ?? { endpoint, host, protocols: [], agent_ids: [], name: agent.name };
    target.agent_ids.push(agent.agent_id);
    for (const protocol of agent.protocols) if (!target.protocols.includes(protocol)) target.protocols.push(protocol);
    targets.set(endpoint, target);
  }
  return [...targets.values()].sort((a, b) => a.endpoint.localeCompare(b.endpoint));
}

export async function probeListedTarget(target: RefreshTarget): Promise<EndpointResult> {
  const now = new Date().toISOString();
  const result: EndpointResult = { endpoint: target.endpoint, host: target.host, protocols: target.protocols,
    priority: 0, agent_count: target.agent_ids.length, mcp: null, a2a: null, probed_at: now };
  if (/\{[^}]+\}|%7b[^%]+%7d/i.test(target.endpoint)) return {
    ...result, skip_reason: "The declared URL contains an unresolved template placeholder. We did not invent an agent ID or send a request.",
  };
  const identity = { ...probeIdentity(target.agent_ids[0]!), userAgent: "Nibbin Trust Index (https://nibbin.com)",
    clientName: "Nibbin Trust Index", clientVersion: "1.0.0" };
  const mcp = target.protocols.some((p) => p.toUpperCase() === "MCP");
  const a2a = target.protocols.some((p) => p.toUpperCase() === "A2A");
  try {
    if (mcp) result.mcp = await probeMcpInterface(target.endpoint, null,
      { attempts: 1, timeoutMs: 6000, identity });
    if (result.mcp?.auth?.required || result.mcp?.rate_limit?.limited || result.mcp?.service_descriptor) return result;
    if ((a2a && !result.mcp?.handshake?.ok) || (!mcp && !a2a)) {
      result.a2a = await probeA2aAgent(target.endpoint, { timeoutMs: 6000, identity, reachability: false,
        registry: { name: target.name, description: null, declared_endpoint: target.endpoint, declared_version: null } });
    }
  } catch (error) {
    result.skip_reason = `Our refresh did not complete: ${error instanceof Error ? error.message.slice(0, 180) : "collector error"}`;
  }
  return result;
}

export async function refreshListed(market: string,
  runProbe: (target: RefreshTarget) => Promise<EndpointResult> = probeListedTarget): Promise<string> {
  const registryBytes = readFileSync(`${market}/data/agents.json`, "utf8");
  const dataset = JSON.parse(registryBytes) as { generated_at: string; agents: Agent[] };
  const targets = planListedRefresh(dataset.agents);
  // This is a single authorized scope, not a general-purpose population sweep.
  if (targets.length !== 40) throw new Error(`scope changed: expected40 listed URLs, found${targets.length}; review before probing`);
  const started = new Date().toISOString();
  const output = `${market}/data/probes/listed-endpoint-probes-${started.replace(/[:.]/g, "-")}.json`;
  const sha = (value: string): string => createHash("sha256").update(value).digest("hex");
  const sourceFiles = ["src/mcp/probe.ts", "src/mcp/interface.ts", "src/mcp/sse.ts", "src/a2a/probe.ts", "src/net.ts"];
  const artifact = { scope: "listed-preferred-endpoints-read-only-v1", status: "running", generated_at: started,
    registry_generated_at: dataset.generated_at, registry_sha256: sha(registryBytes),
    original_probe_sha256: sha(readFileSync(`${market}/data/probes/endpoint-probes.json`, "utf8")),
    collector_source_sha256: Object.fromEntries(sourceFiles.map((name) => [name, sha(readFileSync(new URL(`../${name}`, import.meta.url), "utf8"))])),
    max_concurrent: 4, max_concurrent_per_host: 1, a2a_reachability_run: false,
    selected_urls: targets.map((t) => t.endpoint), results: [] as EndpointResult[] };
  mkdirSync(`${market}/data/probes`, { recursive: true });
  writeFileSync(output, JSON.stringify(artifact, null, 1), { flag: "wx" });
  const grouped = new Map<string, RefreshTarget[]>();
  for (const target of targets) grouped.set(target.host, [...(grouped.get(target.host) ?? []), target]);
  const groups = [...grouped.values()];
  let cursor = 0;
  await Promise.all(Array.from({ length: 4 }, async () => {
    for (;;) {
      const group = groups[cursor++];
      if (!group) return;
      for (const target of group) {
        const result = await runProbe(target);
        artifact.results.push(result);
        writeFileSync(output, JSON.stringify(artifact, null, 1));
        console.error(`[listed ${artifact.results.length}/40] ${target.endpoint}: ${result.mcp?.service_descriptor ? "descriptor" : result.mcp?.handshake?.ok ? "MCP handshake" : result.a2a?.discovery.outcome ?? result.skip_reason ?? result.mcp?.attempts[0]?.reason ?? "no reading"}`);
      }
    }
  }));
  artifact.status = "complete";
  artifact.generated_at = new Date().toISOString();
  writeFileSync(output, JSON.stringify(artifact, null, 1));
  return output;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const market = resolve(process.argv[2] ?? fileURLToPath(new URL("../../../apps/bnb-marketplace", import.meta.url)));
  console.log(await refreshListed(market));
}
