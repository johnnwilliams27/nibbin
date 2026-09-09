/**
 * Probe every distinct endpoint declared by the bnb-marketplace population.
 *
 * WHY DEDUPLICATE BY ENDPOINT. Many registrations in the snapshot declare the
 * same URL: one factory mints many
 * on-chain identities that all point at the same server. Probing per agent
 * would send the same host the same handshake thirty times to learn one fact.
 * So each distinct endpoint is probed ONCE and the result is fanned out to
 * every agent that declares it, which is both faster and the polite thing to
 * do to somebody else's server.
 *
 * WHAT IS SENT. Descriptor reads, handshake and enumeration only. `initialize` + `tools/list`
 * for MCP, a GET of the Agent Card (and one benign `tasks/get` for a task id
 * that cannot exist) for A2A. NO TOOL AND NO SKILL IS EVER INVOKED, so nothing
 * is spent and nothing is mutated. A stdio descriptor is never installed or executed.
 *
 * ETIQUETTE. Two concurrent requests per host, twenty across the run. Two
 * hosts hold half the population between them and must not be burst.
 *
 * WHAT IS NOT PRODUCED. A composite score. Enumerating a tool list is not
 * behavioural evidence, so every assessment this script writes carries
 * `composite: null` and a reason. That is the correct output, not a gap to be
 * filled in later with a plausible number.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { probeMcpInterface, declaredProbeTargets, type InterfaceTranscript } from "../src/mcp/interface.js";
import { probeA2aAgent } from "../src/a2a/probe.js";
import { probeIdentity } from "../src/mcp/probe-identity.js";
import type { A2aTranscript } from "../src/a2a/transcript.js";

const MARKET = resolve(process.env.MARKETPLACE_DIR ?? fileURLToPath(new URL("../../../apps/bnb-marketplace", import.meta.url)));
const AGENTS = `${MARKET}/data/agents.json`;
const OUT_DIR = `${MARKET}/data/probes`;
const RESULTS = `${OUT_DIR}/endpoint-probes.json`;

const CATS = new Set(["rebalancing", "yield", "grid_trading", "health_factor"]);

type AgentRow = {
  agent_id: string;
  name: string;
  description: string;
  category: string;
  protocols: string[];
  endpoint: string | null;
  declared_interfaces?: Array<{ protocol: string; endpoint: string }>;
  scan_feedbacks: number;
  is_reference_agent: boolean;
  chain_id: number;
  token_id: string | null;
  [k: string]: unknown;
};

type Task = {
  endpoint: string;
  host: string;
  protocols: string[];
  agentCount: number;
  inCategory: number;
  feedback: number;
  priority: number;
  sampleAgentId: string;
  sampleName: string;
};

type EndpointResult = {
  endpoint: string;
  host: string;
  protocols: string[];
  priority: number;
  agent_count: number;
  mcp: InterfaceTranscript | null;
  a2a: A2aTranscript | null;
  probed_at: string;
};

const dataset = JSON.parse(readFileSync(AGENTS, "utf8")) as { generated_at: string; agents: AgentRow[] };

// ---- work list ------------------------------------------------------------
const byEndpoint = new Map<string, Task>();
for (const a of dataset.agents) {
  if (a.is_reference_agent === true) continue; // we do not rate our own
  for (const declared of declaredProbeTargets(a)) {
  const ep = declared.endpoint;
  if (ep === "") continue;
  let host = "";
  try {
    host = new URL(ep).hostname;
  } catch {
    host = `unparseable:${ep.slice(0, 40)}`;
  }
  const t = byEndpoint.get(ep) ?? {
    endpoint: ep,
    host,
    protocols: [],
    agentCount: 0,
    inCategory: 0,
    feedback: 0,
    priority: 2,
    sampleAgentId: a.agent_id,
    sampleName: a.name,
  };
  t.agentCount += 1;
  if (CATS.has(a.category)) {
    t.inCategory += 1;
    // Prefer an in-category agent as the identity subject and the registry facts.
    t.sampleAgentId = a.agent_id;
    t.sampleName = a.name;
  }
  t.feedback += typeof a.scan_feedbacks === "number" ? a.scan_feedbacks : 0;
  for (const p of declared.protocols) {
    if (!t.protocols.includes(p)) t.protocols.push(p);
  }
  byEndpoint.set(ep, t);
  }
}
for (const t of byEndpoint.values()) {
  t.priority = t.inCategory > 0 ? 0 : t.feedback > 0 ? 1 : 2;
}

const tasks = [...byEndpoint.values()].sort((a, b) => a.priority - b.priority || b.agentCount - a.agentCount);

// ---- resume ---------------------------------------------------------------
if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });
const results = new Map<string, EndpointResult>();
if (existsSync(RESULTS)) {
  try {
    const prior = JSON.parse(readFileSync(RESULTS, "utf8")) as { results: EndpointResult[] };
    for (const r of prior.results ?? []) results.set(r.endpoint, r);
  } catch {
    /* a half-written checkpoint is not a reason to refuse to run */
  }
}

const limit = Number(process.env.PROBE_LIMIT ?? tasks.length);
const pending = tasks.filter((t) => !results.has(t.endpoint)).slice(0, limit);
console.error(
  `[plan] ${tasks.length} distinct endpoints, ${results.size} already probed, ${pending.length} to go ` +
    `(p0 ${pending.filter((t) => t.priority === 0).length}, p1 ${pending.filter((t) => t.priority === 1).length}, ` +
    `p2 ${pending.filter((t) => t.priority === 2).length}); ${new Set(pending.map((t) => t.host)).size} hosts`,
);

let dirty = false;
function checkpoint(): void {
  if (!dirty) return;
  writeFileSync(
    RESULTS,
    JSON.stringify({ generated_at: new Date().toISOString(), results: [...results.values()] }, null, 1),
  );
  dirty = false;
}

const TIMEOUT_MS = Number(process.env.PROBE_TIMEOUT_MS ?? 12_000);

async function runOne(t: Task): Promise<void> {
  const identity = { ...probeIdentity(t.sampleAgentId), userAgent: "Nibbin Trust Index (https://nibbin.com)",
    clientName: "Nibbin Trust Index", clientVersion: "1.0.0" };
  const declaresMcp = t.protocols.some((p) => p.toUpperCase() === "MCP");
  const declaresA2a = t.protocols.some((p) => p.toUpperCase() === "A2A");
  let mcp: InterfaceTranscript | null = null;
  let a2a: A2aTranscript | null = null;

  if (declaresMcp) {
    try {
      mcp = await probeMcpInterface(
        t.endpoint,
        {
          name: t.sampleName,
          description: null,
          version: null,
          published_at: null,
          first_published_at: null,
          repository_url: null,
        },
        { attempts: 2, spacingMs: 700, timeoutMs: TIMEOUT_MS, identity },
      );
    } catch (err) {
      console.error(`[mcp-throw] ${t.endpoint} ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  const mcpEstablished = mcp?.handshake?.ok === true;
  // A2A is tried when the agent declares it and MCP did not establish a
  // protocol, and for endpoints that declare neither (where the card GET is the
  // cheapest honest way to learn whether anything answers at all).
  const tryA2a = (declaresA2a && !mcpEstablished) || (!declaresMcp && !declaresA2a);
  if (tryA2a) {
    try {
      a2a = await probeA2aAgent(t.endpoint, {
        timeoutMs: TIMEOUT_MS,
        identity,
        registry: {
          name: t.sampleName,
          description: null,
          declared_endpoint: t.endpoint,
          declared_version: null,
        },
        reachability: true,
      });
    } catch (err) {
      console.error(`[a2a-throw] ${t.endpoint} ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  results.set(t.endpoint, {
    endpoint: t.endpoint,
    host: t.host,
    protocols: t.protocols,
    priority: t.priority,
    agent_count: t.agentCount,
    mcp,
    a2a,
    probed_at: new Date().toISOString().slice(0, 19) + "Z",
  });
  dirty = true;
  const verdict = mcpEstablished
    ? `mcp ok (${mcp?.tools?.declared.length ?? 0} tools)`
    : mcp !== null
      ? `mcp ${mcp.handshake?.reason ?? mcp.attempts[0]?.reason ?? "no handshake"}`
      : a2a !== null
        ? `a2a ${a2a.discovery.outcome}`
        : "nothing attempted";
  console.error(`[done p${t.priority}] ${t.endpoint} -> ${verdict}`);
}

// ---- scheduling: <=2 per host, <=20 overall --------------------------------
const PER_HOST = 2;
const GLOBAL = 20;

async function main(): Promise<void> {
  const queues = new Map<string, Task[]>();
  for (const t of pending) {
    const q = queues.get(t.host) ?? [];
    q.push(t);
    queues.set(t.host, q);
  }
  const hosts = [...queues.keys()];
  let hostCursor = 0;
  let inFlight = 0;
  const perHost = new Map<string, number>();
  let completed = 0;

  await new Promise<void>((resolve) => {
    const pump = (): void => {
      while (inFlight < GLOBAL) {
        // Interleave hosts so the run does not march through one estate at once.
        let picked: Task | null = null;
        for (let i = 0; i < hosts.length; i += 1) {
          const host = hosts[(hostCursor + i) % hosts.length] as string;
          const q = queues.get(host);
          if (q === undefined || q.length === 0) continue;
          if ((perHost.get(host) ?? 0) >= PER_HOST) continue;
          picked = q.shift() as Task;
          hostCursor = (hostCursor + i + 1) % hosts.length;
          break;
        }
        if (picked === null) break;
        const task = picked;
        inFlight += 1;
        perHost.set(task.host, (perHost.get(task.host) ?? 0) + 1);
        void runOne(task)
          .catch((err) => console.error(`[fatal-one] ${task.endpoint} ${String(err)}`))
          .finally(() => {
            inFlight -= 1;
            perHost.set(task.host, (perHost.get(task.host) ?? 1) - 1);
            completed += 1;
            if (completed % 5 === 0) checkpoint();
            if (inFlight === 0 && [...queues.values()].every((q) => q.length === 0)) {
              checkpoint();
              resolve();
              return;
            }
            pump();
          });
      }
      if (inFlight === 0 && [...queues.values()].every((q) => q.length === 0)) {
        checkpoint();
        resolve();
      }
    };
    pump();
  });

  checkpoint();
  console.error(`[end] ${results.size} endpoint results in ${RESULTS}`);
}

await main();
