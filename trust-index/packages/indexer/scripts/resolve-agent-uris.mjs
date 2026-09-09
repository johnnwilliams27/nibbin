/**
 * Resolve the `http(s)` agentURIs from a population frame into registration
 * documents, and record what each one declares.
 *
 * This is the `resolvable` stage of the funnel in build-population-frame.mts.
 * The sweep gives every agent's agentURI; roughly half are `data:` URIs that
 * carry the document inline and need nothing further, and the rest point at a
 * URL nobody has read. Until they are read, any statement about how many agents
 * expose an interface describes only the inline half — so leaving them unread
 * and quoting the inline numbers as population figures is a rule 1 violation
 * waiting to happen.
 *
 * WHY PER-HOST LIMITS ARE THE WHOLE DESIGN. These 165,517 URLs live on ~70
 * hosts, and ONE host carries 120,187 of them. A naive 64-way fetcher is not a
 * crawler, it is a denial of service aimed at a single small operator who did
 * nothing but register agents. Concurrency is therefore capped PER HOST, not
 * globally: many hosts progress at once, no host sees more than a handful of
 * connections. It costs wall time we are not short of.
 *
 * Idempotent and resumable: every response is cached on disk by URL, and a
 * cached URL is never re-fetched. Kill it and rerun; it continues.
 *
 * A fetch that fails is recorded as OUR failure with its reason, never as an
 * agent that declares nothing. Those are different facts and the output keeps
 * them apart.
 *
 * Usage:
 *   node scripts/resolve-agent-uris.mjs <population.ndjson> [--out out.ndjson]
 *        [--cache DIR] [--per-host 4] [--max N] [--skip-host h1,h2]
 */
import { createHash } from "node:crypto";
import { mkdirSync, existsSync, readFileSync, writeFileSync, createWriteStream } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { createReadStream } from "node:fs";

const argv = process.argv.slice(2);
const arg = (n, d) => {
  const i = argv.indexOf(n);
  return i === -1 ? d : (argv[i + 1] ?? d);
};
const input = argv.find((a) => !a.startsWith("--") && argv[argv.indexOf(a) - 1]?.startsWith("--") !== true);
if (input === undefined) {
  console.error("Usage: node scripts/resolve-agent-uris.mjs <population.ndjson> [--out …] [--cache …]");
  process.exit(2);
}
const OUT = arg("--out", "resolved-agent-uris.ndjson");
const CACHE = arg("--cache", ".uri-cache");
const PER_HOST = Number(arg("--per-host", "4"));
const MAX = Number(arg("--max", "0")) || Infinity;
const SKIP = new Set(arg("--skip-host", "").split(",").filter((s) => s !== ""));

const UA = "nibbin-trust-index/1.0 (+https://nibbin.com)";
const cachePath = (u) => join(CACHE, `${createHash("sha256").update(u).digest("hex").slice(0, 40)}.json`);

mkdirSync(CACHE, { recursive: true });

// ---------------------------------------------------------------------------
// Read the frame, group by host
// ---------------------------------------------------------------------------
const byHost = new Map();
let total = 0;
await new Promise((resolve) => {
  const rl = createInterface({ input: createReadStream(input), crlfDelay: Infinity });
  rl.on("line", (line) => {
    if (line.trim() === "") return;
    let r;
    try { r = JSON.parse(line); } catch { return; }
    const u = r.token_uri;
    if (typeof u !== "string" || !/^https?:\/\//i.test(u)) return;
    let host;
    try { host = new URL(u).host; } catch { return; }
    if (SKIP.has(host)) return;
    if (!byHost.has(host)) byHost.set(host, []);
    byHost.get(host).push({ agent_id: r.agent_id, owner: r.owner, url: u });
    total += 1;
  });
  rl.on("close", resolve);
});

console.log(`${total.toLocaleString()} http agentURIs across ${byHost.size} hosts`);
for (const [h, list] of [...byHost].sort((a, b) => b[1].length - a[1].length).slice(0, 6)) {
  console.log(`  ${list.length.toLocaleString().padStart(8)}  ${h}`);
}
console.log(`per-host concurrency: ${PER_HOST}\n`);

// ---------------------------------------------------------------------------
// What a registration document declares
// ---------------------------------------------------------------------------
const MACHINE = new Set(["mcp", "a2a", "oasf", "x402", "api"]);
const SOCIAL = new Set(["web", "twitter", "telegram", "chat", "email", "github", "discord", "website"]);

/**
 * A `web` service is a PROFILE PAGE, not an interface. Conflating the two
 * already produced two wrong headline numbers in this project: one host
 * declares 120,187 unique `web` endpoints that are all one website, which reads
 * as 120,187 callable agents if you only check "is there a URL". Machine and
 * social are separated here, at the point of extraction, so no consumer has to
 * remember to do it.
 */
function declares(doc) {
  const machine = [];
  const social = [];
  if (doc === null || typeof doc !== "object") return { machine, social };
  for (const key of ["services", "endpoints", "service", "interfaces"]) {
    const v = doc[key];
    const items = Array.isArray(v)
      ? v
      : v !== null && typeof v === "object"
        ? Object.entries(v).map(([t, e]) => ({ name: t, url: e }))
        : [];
    for (const it of items) {
      if (it === null || typeof it !== "object") continue;
      const t = String(it.type ?? it.name ?? "?").toLowerCase();
      let e = null;
      for (const f of ["url", "endpoint", "serviceEndpoint", "uri"]) {
        if (typeof it[f] === "string" && /^https?:\/\//i.test(it[f])) { e = it[f]; break; }
      }
      if (e === null) continue;
      if (MACHINE.has(t)) machine.push({ type: t, url: e });
      else if (SOCIAL.has(t)) social.push({ type: t, url: e });
      else social.push({ type: t, url: e });
    }
  }
  return { machine, social };
}

// ---------------------------------------------------------------------------
// Fetch, with a hard per-host concurrency cap
// ---------------------------------------------------------------------------
const out = createWriteStream(OUT, { flags: "a" });
let done = 0, fromCache = 0, ok = 0, failed = 0, withMachine = 0;
const started = Date.now();

async function fetchOne(url) {
  const p = cachePath(url);
  if (existsSync(p)) {
    fromCache += 1;
    try { return JSON.parse(readFileSync(p, "utf8")); } catch { /* refetch below */ }
  }
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), 20000);
  try {
    const res = await fetch(url, { headers: { "user-agent": UA, accept: "application/json" }, signal: c.signal, redirect: "follow" });
    const body = await res.text();
    let rec;
    if (!res.ok) {
      // Judge by status AND body: an auth wall is a known state, not a dead
      // endpoint, and an HTML error page is not a registration document.
      rec = { status: res.status, error: `http ${res.status}`, body: body.slice(0, 300) };
    } else {
      try { rec = { status: res.status, doc: JSON.parse(body) }; }
      catch { rec = { status: res.status, error: "not_json", body: body.slice(0, 300) }; }
    }
    writeFileSync(p, JSON.stringify(rec));
    return rec;
  } catch (e) {
    const rec = { status: null, error: e.name === "AbortError" ? "timeout" : String(e.message ?? e).slice(0, 160) };
    writeFileSync(p, JSON.stringify(rec));
    return rec;
  } finally {
    clearTimeout(t);
  }
}

async function runHost(host, list) {
  let i = 0;
  const worker = async () => {
    while (i < list.length && done < MAX) {
      const item = list[i++];
      const rec = await fetchOne(item.url);
      const d = rec.doc ?? null;
      const { machine, social } = declares(d);
      if (rec.error !== undefined) failed += 1; else ok += 1;
      if (machine.length > 0) withMachine += 1;
      out.write(JSON.stringify({
        agent_id: item.agent_id,
        owner: item.owner,
        uri: item.url,
        host,
        // The gap and the finding are different fields on purpose.
        fetch_error: rec.error ?? null,
        http_status: rec.status ?? null,
        name: d?.name ?? null,
        x402: d?.x402Support === true,
        machine,
        social,
      }) + "\n");
      done += 1;
      if (done % 2000 === 0) {
        const mins = (Date.now() - started) / 60000;
        console.log(`  ${done.toLocaleString()}/${Math.min(total, MAX).toLocaleString()}  ok=${ok.toLocaleString()} failed=${failed.toLocaleString()} cached=${fromCache.toLocaleString()} machine=${withMachine.toLocaleString()}  ${mins.toFixed(1)}m`);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(PER_HOST, list.length) }, worker));
}

// Smallest hosts first: they finish quickly and surface the diverse,
// interesting registrations early, while the one huge host grinds in parallel.
const hosts = [...byHost].sort((a, b) => a[1].length - b[1].length);
await Promise.all(hosts.map(([h, l]) => runHost(h, l)));
out.end();

const mins = (Date.now() - started) / 60000;
console.log(`\nresolved ${done.toLocaleString()} in ${mins.toFixed(1)}m`);
console.log(`  documents read      : ${ok.toLocaleString()}`);
console.log(`  our fetch failures  : ${failed.toLocaleString()}  (recorded with a reason, never as "declares nothing")`);
console.log(`  declare a machine interface: ${withMachine.toLocaleString()}`);
console.log(`  -> ${OUT}`);
