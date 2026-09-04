/**
 * Could we generate our own evidence by exercising agents?
 *
 * Scoring other people's reviews reaches 0.75 percent of the registry, because
 * the reviews do not exist. Testing agents ourselves is only possible if agents
 * are reachable, and 73.7 percent of them publish something that looks
 * resolvable. Looking resolvable and answering are different things, and this
 * measures the difference on a deterministic sample.
 *
 * Outcomes reported:
 *
 *   resolved          fetched, and parses as a SPEC 8 registration
 *   resolved (inline) decoded from a data: URI, no network needed
 *   malformed         content came back and does not parse as a registration
 *   unreachable       the request failed, or the host is blocked
 *   absent            the agent published nothing at all
 *
 * A resolved document is then inspected for declared service endpoints, since
 * an agent with no endpoint cannot be exercised however well its metadata
 * parses. That count, not the resolve rate, is the ceiling on a testing
 * product, and the endpoint host table matters as much as the count: coverage
 * concentrated on a handful of operators is not the same as broad coverage.
 *
 * Safety: fetches go through resolveMetadata, which refuses non-http schemes
 * and private, loopback and link-local hosts before any request is made, and
 * the fetcher here follows redirects manually so the same guard runs on every
 * Location. Neither is optional. The registry contains agents pointing at
 * localhost and at raw private addresses, and a naive prober would fetch them
 * from inside whatever network it runs in.
 *
 * Two mistakes in the first version, both of which produced a confident zero.
 * The fetcher returned {status, body, contentLength} where FetchResult wants
 * {ok, status, headers, arrayBuffer}, so `ok` was undefined and every HTTP 200
 * was classified as unreachable: the run reported 0 percent reachable with
 * "HTTP 200" as its most common failure reason. And data: URIs, which are the
 * most available metadata there is because they need no network at all, were
 * counted as an unsupported scheme rather than decoded.
 *
 * Usage:
 *   pnpm --filter @trust-index/indexer exec tsx scripts/probe-reachability.mts \
 *     [--cache <dir>] [--sample <n>] [--seed <n>] [--concurrency <n>]
 */
import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import { MAINNET_IDENTITY_REGISTRY } from "@trust-index/types";
import { decodeIdentityLog } from "../src/decode.js";
import { gunzipSync } from "node:zlib";
import { isBlockedHost, resolveMetadata, type FetchResult } from "../src/metadata.js";

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(name);
  return i === -1 ? fallback : (process.argv[i + 1] ?? fallback);
}

const CACHE = arg("--cache", "cohort-cache");
const SAMPLE = Number(arg("--sample", "600"));
const SEED = Number(arg("--seed", "1"));
const CONCURRENCY = Number(arg("--concurrency", "12"));
const TIMEOUT_MS = Number(arg("--timeout", "8000"));
const IDENTITY = MAINNET_IDENTITY_REGISTRY.toLowerCase();

/** Numerical Recipes LCG, so the sample is reproducible from its seed. */
function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(1664525, s) + 1013904223) >>> 0;
    return s / 0x1_0000_0000;
  };
}

/**
 * A real Response already satisfies FetchResult, so the job here is redirects.
 * resolveMetadata checks the host before the request but cannot re-check a
 * Location, so this follows redirects manually and re-runs the same guard on
 * each hop. Without that a public hostname can 302-rebind into the internal
 * network, which is the exact bypass the module's own documentation warns about.
 */
const MAX_REDIRECTS = 3;

const fetcher = async (url: string, init: { signal: AbortSignal }): Promise<FetchResult> => {
  let current = url;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    const res = await fetch(current, {
      signal: init.signal,
      redirect: "manual",
      headers: { accept: "application/json,*/*" },
    });
    if (res.status < 300 || res.status >= 400) return res as unknown as FetchResult;
    const location = res.headers.get("location");
    if (location === null) return res as unknown as FetchResult;
    let next: URL;
    try {
      next = new URL(location, current);
    } catch {
      return res as unknown as FetchResult;
    }
    if (next.protocol !== "http:" && next.protocol !== "https:") {
      return { ok: false, status: 0, arrayBuffer: async () => new ArrayBuffer(0) };
    }
    if (isBlockedHost(next.hostname)) {
      return { ok: false, status: 0, arrayBuffer: async () => new ArrayBuffer(0) };
    }
    current = next.toString();
  }
  return { ok: false, status: 0, arrayBuffer: async () => new ArrayBuffer(0) };
};

/**
 * Inline metadata, which resolveMetadata does not handle because it is not a
 * fetchable URL. It is nonetheless the most available metadata there is:
 * 15,694 agents publish a data: URI, needing no network at all, and counting
 * those as unreachable would understate coverage badly.
 */
function decodeDataUri(uri: string): { ok: true; json: unknown } | { ok: false; reason: string } {
  const comma = uri.indexOf(",");
  if (comma === -1) return { ok: false, reason: "data: URI with no comma" };
  const meta = uri.slice(5, comma);
  const payload = uri.slice(comma + 1);
  const isBase64 = /;base64/i.test(meta);
  const isGzip = /enc=gzip/i.test(meta);
  try {
    let bytes: Buffer;
    if (isBase64) bytes = Buffer.from(payload, "base64");
    else bytes = Buffer.from(decodeURIComponent(payload), "utf8");
    if (isGzip) bytes = gunzipSync(bytes);
    return { ok: true, json: JSON.parse(bytes.toString("utf8")) };
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message.slice(0, 50) : "decode failed" };
  }
}

async function main(): Promise<void> {
  const agentUri = new Map<string, string>();
  const reader = createInterface({
    input: createReadStream(`${CACHE}/logs.ndjson`, { encoding: "utf8" }),
    crlfDelay: Infinity,
  });
  for await (const line of reader) {
    if (line.length === 0) continue;
    const c = JSON.parse(line) as {
      address: string;
      topics: string[];
      data: string;
      blockNumber: string;
      blockHash: string;
      transactionHash: string;
      logIndex: string;
    };
    if (c.address.toLowerCase() !== IDENTITY) continue;
    const d = decodeIdentityLog({
      address: c.address,
      topics: c.topics,
      data: c.data,
      blockNumber: Number(c.blockNumber),
      blockHash: c.blockHash,
      transactionHash: c.transactionHash,
      logIndex: Number(c.logIndex),
    });
    if (d === null) continue;
    // Last write wins, matching the registry.
    if (d.kind === "registered" || d.kind === "uriUpdated") agentUri.set(d.agentId, d.tokenUri);
  }
  console.log(`agents with an agentURI: ${agentUri.size}`);

  const rand = lcg(SEED);
  const all = [...agentUri.entries()].sort((a, b) => Number(BigInt(a[0]) - BigInt(b[0])));
  const sample = all
    .map((e) => ({ e, r: rand() }))
    .sort((a, b) => a.r - b.r)
    .slice(0, Math.min(SAMPLE, all.length))
    .map((x) => x.e);
  console.log(`probing a uniform sample of ${sample.length}\n`);

  const counts = new Map<string, number>();
  const reasons = new Map<string, number>();
  let withEndpoint = 0;
  let withX402 = 0;
  let active = 0;
  const endpointHosts = new Map<string, number>();
  let done = 0;

  async function probe(agentId: string, uri: string): Promise<void> {
    if (uri.startsWith("data:")) {
      const d = decodeDataUri(uri);
      if (!d.ok) {
        counts.set("malformed", (counts.get("malformed") ?? 0) + 1);
        reasons.set(`inline: ${d.reason}`, (reasons.get(`inline: ${d.reason}`) ?? 0) + 1);
        done += 1;
        return;
      }
      counts.set("resolved (inline)", (counts.get("resolved (inline)") ?? 0) + 1);
      const doc = d.json as { services?: Array<{ endpoint?: unknown }>; active?: boolean; x402Support?: boolean };
      if (doc.active === true) active += 1;
      if (doc.x402Support === true) withX402 += 1;
      const eps = (doc.services ?? [])
        .map((sv) => (typeof sv.endpoint === "string" ? sv.endpoint : null))
        .filter((e): e is string => e !== null && e.length > 0);
      if (eps.length > 0) {
        withEndpoint += 1;
        for (const e of eps) {
          try {
            const h = new URL(e).host;
            endpointHosts.set(h, (endpointHosts.get(h) ?? 0) + 1);
          } catch {
            endpointHosts.set("(not a url)", (endpointHosts.get("(not a url)") ?? 0) + 1);
          }
        }
      }
      done += 1;
      return;
    }
    const r = await resolveMetadata(uri, {
      gatewayUrl: "https://ipfs.io/ipfs/",
      timeoutMs: TIMEOUT_MS,
      maxBytes: 256 * 1024,
      fetcher,
    });
    counts.set(r.status, (counts.get(r.status) ?? 0) + 1);
    if (r.status === "unreachable" || r.status === "malformed") {
      const key = r.reason.slice(0, 60);
      reasons.set(key, (reasons.get(key) ?? 0) + 1);
    }
    if (r.status === "resolved") {
      if (r.data.active) active += 1;
      if (r.data.x402Support) withX402 += 1;
      const endpoints = r.data.services
        .map((s) => (typeof s.endpoint === "string" ? s.endpoint : null))
        .filter((e): e is string => e !== null && e.length > 0);
      if (endpoints.length > 0) {
        withEndpoint += 1;
        for (const e of endpoints) {
          try {
            const h = new URL(e).host;
            endpointHosts.set(h, (endpointHosts.get(h) ?? 0) + 1);
          } catch {
            endpointHosts.set("(not a url)", (endpointHosts.get("(not a url)") ?? 0) + 1);
          }
        }
      }
    }
    done += 1;
    if (done % 100 === 0) console.error(`  ...${done}/${sample.length}`);
  }

  // Bounded concurrency: these are other people's servers.
  let cursor = 0;
  const workers = Array.from({ length: CONCURRENCY }, async () => {
    for (;;) {
      const i = cursor++;
      if (i >= sample.length) return;
      const [agentId, uri] = sample[i]!;
      try {
        await probe(agentId, uri);
      } catch (err) {
        counts.set("prober error", (counts.get("prober error") ?? 0) + 1);
        reasons.set(String(err).slice(0, 60), (reasons.get(String(err).slice(0, 60)) ?? 0) + 1);
        done += 1;
      }
    }
  });
  await Promise.all(workers);

  const pct = (n: number) => ((n / sample.length) * 100).toFixed(1);
  console.log(`\n| Outcome | Agents | Share |`);
  console.log("|---|---|---|");
  for (const [k, n] of [...counts].sort((a, b) => b[1] - a[1])) {
    console.log(`| ${k} | ${n} | ${pct(n)}% |`);
  }

  const resolved = (counts.get("resolved") ?? 0) + (counts.get("resolved (inline)") ?? 0);
  console.log(`\nOf ${resolved} resolved documents:`);
  console.log(`  declare at least one service endpoint: ${withEndpoint}`);
  console.log(`  marked active:                         ${active}`);
  console.log(`  declare x402 payment support:          ${withX402}`);
  console.log(
    `\nCeiling on a testing product from this sample: ${withEndpoint} of ${sample.length} (${pct(withEndpoint)}%) publish a document with somewhere to call.`,
  );

  if (endpointHosts.size > 0) {
    console.log(`\n| Endpoint host | Agents |`);
    console.log("|---|---|");
    for (const [h, n] of [...endpointHosts].sort((a, b) => b[1] - a[1]).slice(0, 15)) {
      console.log(`| ${h} | ${n} |`);
    }
  }

  console.log(`\nTop failure reasons:`);
  for (const [r, n] of [...reasons].sort((a, b) => b[1] - a[1]).slice(0, 12)) {
    console.log(`  ${String(n).padStart(4)}  ${r}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
