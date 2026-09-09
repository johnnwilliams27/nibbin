/**
 * Where is the wall, for every server we hold a transcript for?
 *
 * `probe.ts` answers that question about `initialize` and nothing else, and for
 * a long time the answer was read as though it were about the tools. It is not:
 * `initialize` is a capability exchange and most servers leave it open, so a
 * transcript reading `auth: {required: false, status: 200}` is entirely
 * compatible with every `tools/call` being refused. Six servers were worked by
 * hand in the auth triage and each one produced the same correction to its own
 * transcript, one at a time, as though it were that server's peculiarity.
 *
 * This fills the transcript's `tool_auth` field so nobody has to find it a
 * seventh time. Two sources, in order of preference, and neither invents a
 * vocabulary — every per-call judgement is `diagnoseInvocation`'s:
 *
 *   1. STORED. `assessment.json` already holds real `tools/call` results for
 *      161 servers. Re-reading them costs nobody a request.
 *   2. LIVE (`--live`). For a server whose handshake succeeded, whose tools/list
 *      succeeded, and which nothing has ever called, ONE read-only `tools/call`
 *      settles it. One call, one tool, spaced, and only with --i-have-approval.
 *
 * A server walled at `initialize` needs neither: the wall is already recorded,
 * and there is no tools/list to select from anyway.
 *
 * What it will not do is guess. A server with no stored calls and no live pass
 * keeps `tool_auth: null`, which reads as UNMEASURED everywhere. Writing
 * `walled: false` there would be this project's defining error in miniature —
 * an absence of evidence recorded as evidence of absence — and it is the exact
 * substitution that made "259 auth-walled servers" a floor being reported as a
 * count.
 *
 * Usage:
 *   pnpm exec tsx scripts/measure-tool-auth.mts                     # stored evidence only
 *   pnpm exec tsx scripts/measure-tool-auth.mts --live --i-have-approval [--limit 20]
 */
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { authStanding, classifyToolAuth, handshakeWalled } from "../src/mcp/auth.js";
import { callTool, synthesizeInput, type ToolCallResult } from "../src/mcp/invoke.js";
import { isoNow, parseRpcBody } from "../src/mcp/probe.js";
import { jitteredSpacing, probeIdentity } from "../src/mcp/probe-identity.js";
import { selectToolsForAssessment } from "../src/mcp/select.js";
import { classifyTool } from "../src/mcp/shape.js";
import { guardedFetch } from "../src/net.js";
import type { ProbeTranscript } from "../src/mcp/transcript.js";

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(name);
  return i === -1 ? fallback : (process.argv[i + 1] ?? fallback);
}
const dir = arg("--transcripts", "transcripts");
const limit = Number(arg("--limit", "1000"));
const live = process.argv.includes("--live");
const write = !process.argv.includes("--dry-run");

if (live && !process.argv.includes("--i-have-approval")) {
  console.log("--live CALLS one tool on third-party servers. Re-run with --i-have-approval.");
  process.exit(0);
}

type Loaded = { server: string; transcript: ProbeTranscript };
const loaded: Loaded[] = readdirSync(dir)
  .filter((f) => f.endsWith(".json"))
  .sort()
  .map((f) => ({ server: f.replace(/\.json$/, ""), transcript: JSON.parse(readFileSync(`${dir}/${f}`, "utf8")) as ProbeTranscript }));

// ---------------------------------------------------------------- stored
type StoredRow = { server: string; tool: string; calls: Array<{ label: string; result: ToolCallResult }> };
const stored = new Map<string, Array<{ tool: string; result: ToolCallResult }>>();
try {
  for (const row of JSON.parse(readFileSync("assessment.json", "utf8")) as StoredRow[]) {
    const list = stored.get(row.server) ?? [];
    for (const c of row.calls ?? []) list.push({ tool: row.tool, result: c.result });
    stored.set(row.server, list);
  }
} catch {
  console.log("no assessment.json to read stored calls from; continuing with live evidence only");
}

let fromStored = 0;
for (const { server, transcript } of loaded) {
  const calls = stored.get(server);
  if (calls === undefined || calls.length === 0) continue;
  transcript.tool_auth = classifyToolAuth(calls, transcript.probed_at);
  fromStored += 1;
}

// ------------------------------------------------------------------ live
//
// Eligible: the handshake worked, tools/list worked, tools were declared, and
// nothing has called one. A server already walled at `initialize` is excluded —
// re-asking a closed door is a request spent to learn nothing.
const eligible = loaded.filter(
  (l) =>
    !handshakeWalled(l.transcript) &&
    l.transcript.tools?.ok === true &&
    (l.transcript.tools.declared?.length ?? 0) > 0 &&
    (l.transcript.tool_auth === undefined || l.transcript.tool_auth === null),
);
console.log(`stored evidence classified ${fromStored} servers; ${eligible.length} remain unmeasured`);

async function openSession(endpoint: string, userAgent: string): Promise<string | null | undefined> {
  const headers = {
    "content-type": "application/json",
    accept: "application/json, text/event-stream",
    "mcp-protocol-version": "2025-06-18",
    "user-agent": userAgent,
  };
  const res = await guardedFetch(endpoint, {
    method: "POST",
    headers,
    body: JSON.stringify({
      jsonrpc: "2.0", id: 1, method: "initialize",
      params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "mcp-client", version: "1.0.0" } },
    }),
    timeoutMs: 12_000,
  });
  if (!res.ok) return undefined;
  const sid = res.headers.get("mcp-session-id");
  await guardedFetch(endpoint, {
    method: "POST",
    headers: { ...headers, ...(sid === null ? {} : { "mcp-session-id": sid }) },
    body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized", params: {} }),
    timeoutMs: 12_000,
  });
  return sid;
}

let fromLive = 0;
let unreachable = 0;
if (live && eligible.length > 0) {
  // One tool per server, ranked by select.ts rather than by whichever the
  // operator happened to declare first.
  const selection = selectToolsForAssessment(
    eligible.map((l) => ({ server: l.server, transcript: l.transcript })),
    { perServer: 1, perShape: 10_000 },
  );
  const byServer = new Map(selection.selected.map((s) => [s.server, s]));
  const queue = eligible.filter((l) => byServer.has(l.server)).slice(0, limit);
  console.log(`calling one read-only tool on each of ${queue.length} servers\n`);

  for (const { server, transcript } of queue) {
    const s = byServer.get(server);
    if (s === undefined) continue;
    await new Promise((r) => setTimeout(r, jitteredSpacing(900)));
    const identity = probeIdentity(server);
    // Two attempts, spaced. Egress from a sandbox is flaky enough that a single
    // failed connection has twice been written up in this repository as a
    // property of somebody else's server. One attempt is not a measurement.
    let sid = await openSession(s.endpoint, identity.userAgent);
    if (sid === undefined) {
      await new Promise((r) => setTimeout(r, 2_500));
      sid = await openSession(s.endpoint, identity.userAgent);
    }
    if (sid === undefined) {
      // NEVER a conclusion. The endpoint answered a handshake when the
      // transcript was taken; that it did not answer this minute is a fact
      // about this minute. It stays unmeasured.
      unreachable += 1;
      console.log(`  ${server.padEnd(46)} no session — left unmeasured`);
      continue;
    }
    let r: ToolCallResult;
    try {
      r = await callTool(s.endpoint, s.declaration, classifyTool(s.declaration), {
        sessionId: sid, parseBody: parseRpcBody, userAgent: identity.userAgent,
      });
    } catch (err) {
      console.log(`  ${server.padEnd(46)} REFUSED ${err instanceof Error ? err.message : String(err)}`);
      continue;
    }
    const { skipped } = synthesizeInput(s.declaration.inputSchema);
    transcript.tool_auth = classifyToolAuth([{ tool: s.declaration.name, result: r }], isoNow());
    fromLive += 1;
    console.log(
      `  ${server.padEnd(46)} ${(transcript.tool_auth?.walled === true ? "WALLED" : "open").padEnd(7)}` +
        ` ${Object.keys(transcript.tool_auth?.verdicts ?? {}).join(",").padEnd(18)} ${s.declaration.name}` +
        (skipped.length > 0 ? `  [skipped ${skipped.length} credential params]` : ""),
    );
  }
}

// ---------------------------------------------------------------- persist
if (write) {
  for (const { server, transcript } of loaded) {
    if (transcript.tool_auth === undefined) continue;
    // Two-space, no trailing newline: exactly how census.mts writes them, so
    // adding a field shows up as one added field in the diff and not as 600
    // reformatted files.
    writeFileSync(`${dir}/${server}.json`, JSON.stringify(transcript, null, 2));
  }
}

// --------------------------------------------------------------- the count
const tally: Record<string, number> = { walled: 0, open: 0, unmeasured: 0 };
const where: Record<string, number> = { initialize: 0, "tools/call": 0 };
const signals: Record<string, number> = { http_status: 0, in_band: 0 };
for (const { transcript } of loaded) {
  const standing = authStanding(transcript);
  tally[standing] = (tally[standing] ?? 0) + 1;
  if (standing !== "walled") continue;
  if (handshakeWalled(transcript)) where.initialize! += 1;
  else {
    where["tools/call"]! += 1;
    const sig = transcript.tool_auth?.signal;
    if (sig !== null && sig !== undefined) signals[sig] = (signals[sig] ?? 0) + 1;
  }
}
console.log(`\n| Standing | Servers |`);
console.log("|---|---|");
for (const [k, v] of Object.entries(tally)) console.log(`| ${k} | ${v} |`);
console.log(`\nwalled at initialize: ${where.initialize}   walled at tools/call: ${where["tools/call"]}`);
console.log(`of the tools/call walls: ${signals.http_status} announced by HTTP status, ${signals.in_band} in band inside a 2xx`);
console.log(`live calls made: ${fromLive}; endpoints that did not answer this pass: ${unreachable}`);
