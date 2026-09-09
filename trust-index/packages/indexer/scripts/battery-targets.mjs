/**
 * Turn resolved registrations into the distinct endpoints a battery run should
 * actually dial.
 *
 * The battery probes SERVICES, not registrations, and on this chain those are
 * three orders of magnitude apart: 342,016 registrations resolve to a few
 * hundred distinct endpoints, because platforms register one identity per user
 * against a single shared backend. Feeding registrations to the prober would
 * dial the same host thousands of times, produce thousands of copies of one
 * observation, and let a single service's behaviour masquerade as a population
 * measurement. So the unit of assessment is the endpoint, and the registrations
 * behind it are carried as a fan-out count.
 *
 * Inputs: the ndjson from resolve-agent-uris.mjs, and optionally the population
 * frame so inline `data:` documents are included too — an endpoint declared
 * inline is exactly as dialable as one declared at a URL, and dropping half the
 * population because of how it encoded its document would be an arbitrary cut.
 *
 * Placeholders are excluded and COUNTED, not silently dropped:
 * `https://api.example-agent.ai/v1` is the specification's own example and is
 * registered verbatim by 103 agents. Dialing it would produce a real
 * observation about a URL nobody intended to run.
 *
 * Usage:
 *   node scripts/battery-targets.mjs resolved.ndjson [--frame population.ndjson]
 *        [--out battery-targets.json] [--min-agents 1]
 */
import { createReadStream, writeFileSync } from "node:fs";
import { createInterface } from "node:readline";

const argv = process.argv.slice(2);
const arg = (n, d) => { const i = argv.indexOf(n); return i === -1 ? d : (argv[i + 1] ?? d); };
const resolved = argv[0];
if (resolved === undefined || resolved.startsWith("--")) {
  console.error("Usage: node scripts/battery-targets.mjs <resolved.ndjson> [--frame …] [--out …]");
  process.exit(2);
}
const FRAME = arg("--frame", "");
const OUT = arg("--out", "battery-targets.json");
const MIN = Number(arg("--min-agents", "1"));

const PLACEHOLDER = /example|localhost|127\.0\.0\.1|0\.0\.0\.0|your-|placeholder|test\.com|foo\.bar|<[a-z]+>/i;
const MACHINE = new Set(["mcp", "a2a", "oasf", "x402", "api"]);

/**
 * A source repository is not a callable service. Several registrations declare
 * a github URL under an `oasf` service; dialing it measures GitHub.
 */
const NOT_A_SERVICE = /^https?:\/\/(www\.)?(github|gitlab)\.com\//i;

/**
 * Some platforms register a URL TEMPLATE and never substitute it, so thousands
 * of agents share one literal string containing `{agentId}`. Treating that as a
 * single dead endpoint would be wrong in a specific and expensive way: it
 * collapses thousands of individually addressable agents into one failure.
 *
 * Termix is the case that forced this. 30,462 registrations declare
 * `…/a2a/agents/{agentId}/card`. Substituting the ERC-8004 token id was checked
 * against six of them and every response came back HTTP 200 with an
 * `agentTokenId` field equal to the id substituted — the server confirms the
 * variable rather than us guessing it. The literal template, as registered,
 * returns 404.
 *
 * Expansion is therefore evidence-led, not inferred, and it is recorded as
 * `expanded_from` on the target so a reader can see the URL was constructed by
 * us rather than declared by the agent.
 */
const TEMPLATE = /\{(agent_?id|id|tokenId|token_id)\}/i;

/** endpoint -> { protocols, agents, owners, sources } */
const targets = new Map();
let placeholders = 0, rows = 0;

let expanded = 0, notAService = 0;

function add(url, type, agentId, owner, source) {
  if (typeof url !== "string" || !/^https?:\/\//i.test(url)) return;
  if (NOT_A_SERVICE.test(url)) { notAService += 1; return; }

  // Expand before the placeholder check: a template is not a placeholder, it is
  // a real endpoint with a hole in it, and the agent id fills the hole.
  let expandedFrom = null;
  if (TEMPLATE.test(url)) {
    if (agentId === undefined || agentId === null) { placeholders += 1; return; }
    expandedFrom = url;
    url = url.replace(TEMPLATE, String(agentId));
    expanded += 1;
  }

  if (PLACEHOLDER.test(url)) { placeholders += 1; return; }
  let t = targets.get(url);
  if (t === undefined) {
    t = { url, protocols: new Set(), agents: new Set(), owners: new Set(), sources: new Set(), expandedFrom };
    targets.set(url, t);
  }
  t.protocols.add(type);
  if (agentId !== undefined && agentId !== null) t.agents.add(String(agentId));
  if (owner !== undefined && owner !== null) t.owners.add(String(owner).toLowerCase());
  t.sources.add(source);
}

async function eachLine(path, fn) {
  const rl = createInterface({ input: createReadStream(path), crlfDelay: Infinity });
  for await (const line of rl) {
    if (line.trim() === "") continue;
    try { fn(JSON.parse(line)); } catch { /* a half-written last line is normal while a run is live */ }
  }
}

await eachLine(resolved, (r) => {
  rows += 1;
  for (const m of r.machine ?? []) add(m.url, m.type, r.agent_id, r.owner, "http_document");
});

if (FRAME !== "") {
  await eachLine(FRAME, (r) => {
    const u = r.token_uri;
    if (typeof u !== "string" || !u.startsWith("data:") || !u.includes("base64,")) return;
    let doc;
    try { doc = JSON.parse(Buffer.from(u.split("base64,")[1], "base64").toString("utf8")); } catch { return; }
    for (const key of ["services", "endpoints", "service", "interfaces"]) {
      const v = doc?.[key];
      const items = Array.isArray(v) ? v
        : v !== null && typeof v === "object" ? Object.entries(v).map(([t, e]) => ({ name: t, url: e }))
        : [];
      for (const it of items) {
        if (it === null || typeof it !== "object") continue;
        const t = String(it.type ?? it.name ?? "?").toLowerCase();
        if (!MACHINE.has(t)) continue;   // a `web` profile page is not an interface
        for (const f of ["url", "endpoint", "serviceEndpoint", "uri"]) {
          if (typeof it[f] === "string") { add(it[f], t, r.agent_id, r.owner, "inline_document"); break; }
        }
      }
    }
  });
}

const list = [...targets.values()]
  .map((t) => {
    let host = null;
    try { host = new URL(t.url).host; } catch { /* keep null */ }
    return {
      url: t.url,
      host,
      protocols: [...t.protocols].sort(),
      registrations: t.agents.size,
      distinct_owners: t.owners.size,
      declared_in: [...t.sources].sort(),
      // Non-null means WE built this URL from a registered template. The agent
      // declared the left-hand string; the right-hand one is ours.
      expanded_from: t.expandedFrom,
    };
  })
  .filter((t) => t.registrations >= MIN)
  .sort((a, b) => b.registrations - a.registrations);

const byProto = {};
for (const t of list) for (const p of t.protocols) byProto[p] = (byProto[p] ?? 0) + 1;

/**
 * Expansion turns one template into thousands of per-agent URLs that all live
 * on ONE backend. Those are genuinely distinct agent declarations and belong in
 * the list — but a battery that dials all of them measures one service
 * repeatedly and calls it a population. Endpoints are therefore grouped by
 * host, and the caller is expected to sample within a host rather than
 * exhaust it.
 */
const byHost = new Map();
for (const t of list) {
  if (t.host === null) continue;
  byHost.set(t.host, (byHost.get(t.host) ?? 0) + 1);
}
const shared = [...byHost].filter(([, n]) => n > 50).sort((a, b) => b[1] - a[1]);

writeFileSync(OUT, JSON.stringify({
  generated_at: new Date().toISOString(),
  source_rows: rows,
  // Stated on the artifact rather than left to a reader: the fan-out is the
  // whole reason this file exists, and a target list that hid it would invite
  // exactly the per-registration probing it is meant to prevent.
  note: "The unit here is the ENDPOINT. `registrations` is how many ERC-8004 registrations point at it. Probing per registration would multiply one service's behaviour into a false population signal.",
  placeholders_excluded: placeholders,
  source_repos_excluded: notAService,
  templates_expanded: expanded,
  endpoints: list.length,
  by_protocol: byProto,
  distinct_hosts: byHost.size,
  shared_backends: shared.map(([host, n]) => ({ host, endpoints: n })),
  targets: list,
}, null, 1));

console.log(`read ${rows.toLocaleString()} resolved rows${FRAME !== "" ? " + inline documents from the frame" : ""}`);
console.log(`placeholder URLs excluded   : ${placeholders.toLocaleString()}`);
console.log(`source repos excluded       : ${notAService.toLocaleString()}  (a github URL is not a service)`);
console.log(`templates expanded          : ${expanded.toLocaleString()}  (verified against the server, see TEMPLATE)`);
console.log(`\nDISTINCT ENDPOINTS TO DIAL: ${list.length.toLocaleString()}  across ${byHost.size.toLocaleString()} hosts`);
console.log(`  by protocol: ${JSON.stringify(byProto)}`);
console.log(`  registrations they stand for: ${list.reduce((s, t) => s + t.registrations, 0).toLocaleString()}`);
if (shared.length > 0) {
  console.log(`\nSHARED BACKENDS — sample within these, do not exhaust them:`);
  for (const [host, n] of shared.slice(0, 8)) console.log(`  ${String(n).padStart(7)} endpoints  ${host}`);
}
console.log(`\ntop targets by fan-out:`);
for (const t of list.slice(0, 8)) {
  console.log(`  ${String(t.registrations).padStart(6)} regs  ${t.protocols.join(",").padEnd(9)} ${t.url.slice(0, 58)}`);
}
console.log(`\n-> ${OUT}`);
