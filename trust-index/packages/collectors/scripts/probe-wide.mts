/**
 * Probe the whole registry, not a sample of it.
 *
 * We hold 600 transcripts. The registry lists 15,045 active servers, every one
 * with a remote URL. So 96% of the population has never been looked at, and the
 * credential work — which is expensive, needs accounts, and unlocks servers one
 * at a time — has been competing for attention with a sweep that needs no
 * account, no payment and no terms at all.
 *
 * `census.mts` produced the 600 by sampling with a per-host cap of 5. That cap
 * is right for a census (it stops two gateways with a shared template eating
 * 16% of the sample) and wrong for a sweep, where the point is to reach
 * everything.
 *
 * TWO THINGS THIS ADDS THAT A LONG RUN CANNOT DO WITHOUT.
 *
 *   RESUME. 15,000 servers at a few seconds each is a run measured in hours,
 *   against third parties, from a container that gets reclaimed. Re-probing
 *   from the top after an interruption spends somebody else's capacity to
 *   re-learn what we already stored. Existing transcripts are skipped.
 *
 *   PER-HOST THROTTLING. Global concurrency alone is not politeness. Large
 *   parts of this registry live behind a handful of gateways, so forty workers
 *   drawing from a shuffled queue can still land forty simultaneous requests on
 *   one host. Each host is limited independently, and hosts are interleaved so
 *   the queue does not march through one operator's entire estate at once.
 *
 * Handshake and tools/list only. No tool is ever called here, so nothing is
 * spent and nothing is mutated — this is the cheap half of the assessment, and
 * the half that scales.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { probeMcpServer } from "../src/mcp/probe.js";
import type { ProbeTranscript, RegistryFacts } from "../src/mcp/transcript.js";

const arg = (n: string, d: string): string => {
  const i = process.argv.indexOf(n);
  return i === -1 ? d : (process.argv[i + 1] ?? d);
};
const has = (n: string): boolean => process.argv.includes(n);

if (!has("--i-have-approval")) {
  console.log(
    "This connects to every server in the registry to read its declarations.\n" +
      "Handshake and tools/list only — no tool is called — but it is still an\n" +
      "outward-facing action against thousands of third parties.\n" +
      "Re-run with --i-have-approval.",
  );
  process.exit(0);
}

const CENSUS = arg("--census", "census-remote.json");
const DIR = arg("--transcripts", "transcripts");
const CONCURRENCY = Number(arg("--concurrency", "40"));
const PER_HOST = Number(arg("--per-host-concurrency", "3"));
const HOST_SPACING_MS = Number(arg("--host-spacing-ms", "400"));
const TIMEOUT_MS = Number(arg("--timeout-ms", "8000"));
const LIMIT = Number(arg("--limit", "0")); // 0 = everything
const SHARD = Number(arg("--shard", "0"));
const SHARDS = Number(arg("--shards", "1"));

/**
 * The census row, typed against the real RegistryFacts rather than a narrowed
 * `{name}`. The facts carry published_at, first_published_at and
 * repository_url, which are exactly what the maintenance dimension scores —
 * narrowing the type here would have compiled fine and silently handed the
 * probe a transcript with no maintenance evidence in it.
 */
type Entry = { facts: RegistryFacts; remotes: Array<{ url: string }>; status?: string };
const entries = (JSON.parse(readFileSync(CENSUS, "utf8")) as Entry[]).filter(
  (e) => e.status !== "deprecated" && Array.isArray(e.remotes) && e.remotes.length > 0,
);

mkdirSync(DIR, { recursive: true });
const safeName = (n: string): string => n.replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 180);
const already = new Set(readdirSync(DIR).filter((f) => f.endsWith(".json")).map((f) => f.slice(0, -5)));

const hostOf = (u: string): string => {
  try {
    return new URL(u).hostname;
  } catch {
    return "(unparseable)";
  }
};

/**
 * Interleave by host, so the queue alternates operators instead of walking one
 * estate end to end. With a per-host limit this is what keeps a big gateway
 * from being the only thing we talk to for twenty minutes.
 */
const byHost = new Map<string, Entry[]>();
for (const e of entries) {
  const name = safeName(e.facts.name);
  if (already.has(name)) continue;
  const h = hostOf(e.remotes[0]!.url);
  byHost.set(h, [...(byHost.get(h) ?? []), e]);
}
const queue: Entry[] = [];
for (let round = 0; ; round += 1) {
  let added = false;
  for (const list of byHost.values()) {
    const e = list[round];
    if (e === undefined) continue;
    queue.push(e);
    added = true;
  }
  if (!added) break;
}
const work = SHARDS > 1 ? queue.filter((_, i) => i % SHARDS === SHARD) : queue;
const todo = LIMIT > 0 ? work.slice(0, LIMIT) : work;

console.log(
  `registry: ${entries.length} active  |  already have: ${already.size}  |  to probe: ${todo.length}\n` +
    `hosts: ${byHost.size}  |  concurrency ${CONCURRENCY} global, ${PER_HOST} per host, ${HOST_SPACING_MS}ms host spacing` +
    (SHARDS > 1 ? `  |  shard ${SHARD}/${SHARDS}` : "") +
    `\n`,
);

/** In-flight count and last-dispatch time, per host. */
const inflight = new Map<string, number>();
const lastAt = new Map<string, number>();
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

let cursor = 0;
let done = 0;
let ok = 0;
let walled = 0;
let failed = 0;
const started = Date.now();

async function claim(): Promise<Entry | null> {
  // Take the next entry whose host has capacity. Scanning forward rather than
  // blocking on the head keeps one saturated gateway from stalling the run.
  for (;;) {
    if (cursor >= todo.length) return null;
    for (let i = cursor; i < Math.min(cursor + 200, todo.length); i += 1) {
      const e = todo[i];
      if (e === undefined) continue;
      const h = hostOf(e.remotes[0]!.url);
      const since = Date.now() - (lastAt.get(h) ?? 0);
      if ((inflight.get(h) ?? 0) < PER_HOST && since >= HOST_SPACING_MS) {
        todo[i] = undefined as unknown as Entry;
        if (i === cursor) while (cursor < todo.length && todo[cursor] === undefined) cursor += 1;
        inflight.set(h, (inflight.get(h) ?? 0) + 1);
        lastAt.set(h, Date.now());
        return e;
      }
    }
    // Everything in the window is host-limited right now; wait rather than spin.
    await sleep(120);
    if (cursor >= todo.length) return null;
  }
}

const workers = Array.from({ length: CONCURRENCY }, async () => {
  for (;;) {
    const e = await claim();
    if (e === null) return;
    const endpoint = e.remotes[0]!.url;
    const host = hostOf(endpoint);
    try {
      const t: ProbeTranscript = await probeMcpServer(endpoint, e.facts, { attempts: 1, timeoutMs: TIMEOUT_MS });
      writeFileSync(`${DIR}/${safeName(e.facts.name)}.json`, JSON.stringify(t, null, 2));
      if (t.tools?.ok === true) ok += 1;
      else if (t.auth?.required === true) walled += 1;
      else failed += 1;
    } catch {
      // A probe that throws is our failure to obtain a reading, not a fact
      // about the subject. It is counted and left without a transcript so a
      // later run retries it rather than inheriting a fabricated verdict.
      failed += 1;
    } finally {
      inflight.set(host, Math.max(0, (inflight.get(host) ?? 1) - 1));
      done += 1;
      if (done % 100 === 0) {
        const rate = done / ((Date.now() - started) / 1000);
        const left = Math.round((todo.length - done) / Math.max(rate, 0.01) / 60);
        console.error(
          `  ${done}/${todo.length}  ok=${ok} walled=${walled} failed=${failed}  ` +
            `${rate.toFixed(1)}/s  ~${left}m left`,
        );
      }
    }
  }
});

await Promise.all(workers);
console.log(
  `\ndone in ${Math.round((Date.now() - started) / 60000)}m: ${done} probed  ` +
    `tools listed ${ok}  auth-walled ${walled}  no reading ${failed}\n` +
    `transcripts now on disk: ${readdirSync(DIR).filter((f) => f.endsWith(".json")).length}`,
);
