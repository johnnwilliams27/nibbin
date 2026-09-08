/**
 * A second look at every server we got no reading from.
 *
 * The wide sweep left 2,786 servers with neither a tool list nor an auth wall.
 * Filing those as "broken" without a second attempt is the error this project
 * keeps making, and a breakdown by cause showed most of them are ours:
 *
 *   SSE TRANSPORT. 550 of the failures declare the `sse` transport, which needs
 *   a GET to open a stream and a POST to the url that stream names. We only ever
 *   POSTed, so they answered 404/405/400 and we recorded them as gone. Hand-
 *   checked, servers filed as "HTTP 404" answer a GET with 200 and a well-formed
 *   endpoint event.
 *
 *   TRANSIENT. 503, 502, 500, 429 and timeouts are a moment, not a property.
 *
 * Genuinely dead — DNS that does not resolve, 404 on a streamable-http endpoint
 * that answers nothing else, 410 — stays dead, and is left alone rather than
 * retried into a different answer.
 */
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { probeMcpServer } from "../src/mcp/probe.js";
import { probeViaSse } from "../src/mcp/sse.js";
import type { ProbeTranscript, RegistryFacts } from "../src/mcp/transcript.js";

const arg = (n: string, d: string): string => {
  const i = process.argv.indexOf(n);
  return i === -1 ? d : (process.argv[i + 1] ?? d);
};
if (!process.argv.includes("--i-have-approval")) {
  console.log("Re-contacts servers that gave no reading. Re-run with --i-have-approval.");
  process.exit(0);
}
const CONCURRENCY = Number(arg("--concurrency", "24"));
const LIMIT = Number(arg("--limit", "0"));

type Entry = { facts: RegistryFacts; remotes: Array<{ url: string; type?: string; transport_type?: string }>; status?: string };
const census = JSON.parse(readFileSync("census-remote.json", "utf8")) as Entry[];
const safeName = (n: string): string => n.replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 180);
const byName = new Map(census.map((e) => [safeName(e.facts.name), e]));

/** Causes that are worth a second attempt, and causes that are not. */
const DEAD = /ENOTFOUND|EAI_AGAIN|HTTP 410|certificate|self-signed/i;

type Job = { name: string; entry: Entry; url: string; sse: boolean; why: string };
const jobs: Job[] = [];
for (const f of readdirSync("transcripts").filter((x) => x.endsWith(".json"))) {
  let t: ProbeTranscript;
  try {
    t = JSON.parse(readFileSync(`transcripts/${f}`, "utf8")) as ProbeTranscript;
  } catch {
    continue;
  }
  if (t.tools?.ok === true || t.auth?.required === true) continue;
  const name = f.replace(/\.json$/, "");
  const entry = byName.get(name);
  if (entry === undefined) continue;
  const remote = entry.remotes[0]!;
  const reason = String((t.attempts ?? [])[0]?.reason ?? t.handshake?.reason ?? "");
  if (DEAD.test(reason)) continue;
  const declaredSse = (remote.type ?? remote.transport_type) === "sse";
  // Try SSE when the registry says so, and also when the symptom matches what
  // POSTing at an SSE endpoint looks like from the outside.
  const looksSse = /HTTP 40[45]|no JSON-RPC frame|HTTP 400/i.test(reason) || /\/sse\b/.test(remote.url);
  jobs.push({ name, entry, url: remote.url, sse: declaredSse || looksSse, why: reason.slice(0, 50) });
}
// Declared-SSE first. A sample taken alphabetically was overwhelmingly
// streamable-http servers that are genuinely dead — 503s, real 404s, dead DNS —
// and recovered 6 of 200, which says nothing about the transport fix. The
// servers the fix is FOR are the ones whose registry entry says `sse`.
jobs.sort((a, b) => Number(b.sse) - Number(a.sse));

// Registry rows nobody can probe: the url still has its template placeholder.
// `https://{api_host}/mcp` is not a server that is down, it is a catalogue
// entry that was never filled in, and counting it as a failed subject would put
// a registry defect into somebody's rating.
const PLACEHOLDER = /\{[a-z_]+\}/i;
const templated = jobs.filter((j) => PLACEHOLDER.test(j.url));
const real = jobs.filter((j) => !PLACEHOLDER.test(j.url));
if (templated.length > 0) console.log(`skipping ${templated.length} registry rows with unsubstituted url placeholders (e.g. ${templated[0]!.url})`);

const todo = LIMIT > 0 ? real.slice(0, LIMIT) : real;
console.log(`retrying ${todo.length} servers  (${todo.filter((j) => j.sse).length} via SSE, ${todo.filter((j) => !j.sse).length} plain retry)\n`);

let done = 0, recovered = 0, walled = 0, still = 0;
let cursor = 0;
const workers = Array.from({ length: CONCURRENCY }, async () => {
  for (;;) {
    const j = todo[cursor++];
    if (j === undefined) return;
    try {
      let saved = false;
      if (j.sse) {
        const r = await probeViaSse(
          j.url,
          [
            { id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "mcp-client", version: "1.0.0" } } },
            { id: 2, method: "notifications/initialized", params: {} },
            { id: 3, method: "tools/list", params: {} },
          ],
          { timeoutMs: 15_000 },
        );
        const init = r.replies.get(1) as { result?: { protocolVersion?: string; serverInfo?: { name?: string; version?: string }; instructions?: string } } | undefined;
        const list = r.replies.get(3) as { result?: { tools?: unknown[] } } | undefined;
        if (r.ok && Array.isArray(list?.result?.tools)) {
          const t: ProbeTranscript = {
            transcript_version: "1",
            probe_id: "probe:mcp:v1",
            endpoint: j.url,
            probed_at: `${new Date().toISOString().slice(0, 19)}Z`,
            attempts: [{ attempt: 1, ts: `${new Date().toISOString().slice(0, 19)}Z`, reachable: true, status: r.status, reason: null, elapsedMs: r.elapsedMs }],
            handshake: {
              ok: true,
              protocolVersion: init?.result?.protocolVersion ?? null,
              serverName: init?.result?.serverInfo?.name ?? null,
              serverVersion: init?.result?.serverInfo?.version ?? null,
              instructions: init?.result?.instructions ?? null,
              reason: null,
            },
            tools: { ok: true, declared: list.result!.tools as never[], reason: null },
            registry: j.entry.facts,
            auth: { required: false, status: r.status, scheme: null },
            // Recorded so nobody has to rediscover why this subject needed a
            // different door: the transcript says which transport answered.
            transport: "sse",
          } as unknown as ProbeTranscript;
          writeFileSync(`transcripts/${j.name}.json`, JSON.stringify(t, null, 2));
          recovered += 1;
          saved = true;
        }
      }
      if (!saved) {
        const t = await probeMcpServer(j.url, j.entry.facts, { attempts: 2, timeoutMs: 15_000 });
        if (t.tools?.ok === true) { recovered += 1; writeFileSync(`transcripts/${j.name}.json`, JSON.stringify(t, null, 2)); }
        else if (t.auth?.required === true) { walled += 1; writeFileSync(`transcripts/${j.name}.json`, JSON.stringify(t, null, 2)); }
        else still += 1;
      }
    } catch {
      still += 1;
    } finally {
      done += 1;
      if (done % 100 === 0) console.error(`  ${done}/${todo.length}  recovered=${recovered} walled=${walled} still-failing=${still}`);
    }
  }
});
await Promise.all(workers);
console.log(`\nRECOVERED ${recovered}  |  now known auth-walled ${walled}  |  still no reading ${still}`);
