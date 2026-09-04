/**
 * Call one read-only tool of each shape, and record what actually happens.
 *
 * This is the first script that exercises somebody else's software. Every
 * safety rule agreed so far is enforced here and re-enforced inside callTool:
 *
 *   - read_only tools ONLY, re-checked at the moment of the call
 *   - one call per tool, one tool per server, spaced, identified user agent
 *   - arguments synthesized from the tool's own schema, required fields only
 *   - nothing that looks like a credential is ever sent
 *
 * It reads the transcripts the census already persisted, so it re-probes
 * nobody to decide what to call. Selection is deterministic.
 *
 * Usage:
 *   pnpm exec tsx scripts/call-tools.mts --i-have-approval [--per-shape 10]
 */
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { classifyTool } from "../src/mcp/shape.js";
import { callTool, synthesizeInput, type ToolCallResult } from "../src/mcp/invoke.js";
import { parseRpcBody } from "../src/mcp/probe.js";
import { guardedFetch } from "../src/net.js";
import type { ProbeTranscript, ToolDeclaration } from "../src/mcp/transcript.js";

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(name);
  return i === -1 ? fallback : (process.argv[i + 1] ?? fallback);
}
const perShape = Number(arg("--per-shape", "10"));
const dir = arg("--transcripts", "transcripts");

if (!process.argv.includes("--i-have-approval")) {
  console.log("This CALLS tools on third-party servers. Re-run with --i-have-approval.");
  process.exit(0);
}

type Candidate = { server: string; endpoint: string; declaration: ToolDeclaration; shape: string; basis: string };

// Selection: one tool per server, at most `perShape` per shape, so the mapping
// reflects variety rather than one prolific server's whole catalogue.
const candidates = new Map<string, Candidate[]>();
const usedServers = new Set<string>();
for (const f of readdirSync(dir).filter((x) => x.endsWith(".json")).sort()) {
  const t = JSON.parse(readFileSync(`${dir}/${f}`, "utf8")) as ProbeTranscript;
  if (t.tools?.ok !== true) continue;
  if (t.auth?.required === true) continue;
  for (const d of t.tools.declared) {
    const c = classifyTool(d);
    if (c.binding.kind !== "read_only") continue;
    const list = candidates.get(c.shape) ?? [];
    if (list.length >= perShape) continue;
    if (usedServers.has(t.endpoint)) continue;
    usedServers.add(t.endpoint);
    list.push({ server: f.replace(/\.json$/, ""), endpoint: t.endpoint, declaration: d, shape: c.shape, basis: c.binding.basis });
    candidates.set(c.shape, list);
    break;
  }
}

console.log(`Selected ${[...candidates.values()].flat().length} tools across ${candidates.size} shapes.\n`);
for (const [shape, list] of [...candidates].sort()) {
  console.log(`  ${shape.padEnd(14)} ${list.length}`);
}

async function openSession(endpoint: string): Promise<string | null | undefined> {
  const res = await guardedFetch(endpoint, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      "mcp-protocol-version": "2025-06-18",
      "user-agent": "trust-index-probe/0.1 (+https://github.com/johnnwilliams27/nibbin)",
    },
    body: JSON.stringify({
      jsonrpc: "2.0", id: 1, method: "initialize",
      params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "trust-index-probe", version: "0.1.0" } },
    }),
    timeoutMs: 10_000,
  });
  if (!res.ok) return undefined;
  const sid = res.headers.get("mcp-session-id");
  await guardedFetch(endpoint, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      "mcp-protocol-version": "2025-06-18",
      "user-agent": "trust-index-probe/0.1 (+https://github.com/johnnwilliams27/nibbin)",
      ...(sid === null ? {} : { "mcp-session-id": sid }),
    },
    body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized", params: {} }),
    timeoutMs: 10_000,
  });
  return sid;
}

const results: Array<ToolCallResult & { server: string; endpoint: string }> = [];
for (const [shape, list] of [...candidates].sort()) {
  console.log(`\n=== ${shape} ===`);
  for (const c of list) {
    await new Promise((r) => setTimeout(r, 400));
    const { args, skipped } = synthesizeInput(c.declaration.inputSchema);
    const sid = await openSession(c.endpoint);
    if (sid === undefined) {
      console.log(`  ${c.declaration.name}: could not open a session`);
      continue;
    }
    let r: ToolCallResult;
    try {
      r = await callTool(c.endpoint, c.declaration, classifyTool(c.declaration), { sessionId: sid, parseBody: parseRpcBody });
    } catch (err) {
      console.log(`  ${c.declaration.name}: REFUSED ${err instanceof Error ? err.message : String(err)}`);
      continue;
    }
    results.push({ ...r, server: c.server, endpoint: c.endpoint });
    const verdict = !r.ok ? `FAILED ${r.reason}` : r.isError ? "tool reported an error" : "ok";
    console.log(
      `  ${c.declaration.name.padEnd(34)} ${verdict.padEnd(34)} ${String(r.elapsedMs).padStart(6)}ms ${String(r.responseBytes).padStart(7)}B` +
        (skipped.length > 0 ? `  [skipped ${skipped.length} credential params]` : ""),
    );
  }
}

writeFileSync("tool-calls.json", JSON.stringify(results, null, 2));

const by = <T,>(f: (r: (typeof results)[number]) => T) => {
  const m = new Map<T, number>();
  for (const r of results) m.set(f(r), (m.get(f(r)) ?? 0) + 1);
  return [...m].sort((a, b) => Number(b[1]) - Number(a[1]));
};
const ok = results.filter((r) => r.ok && !r.isError);
console.log(`\n\n| Outcome | Calls |`);
console.log("|---|---|");
console.log(`| answered usefully | ${ok.length} of ${results.length} |`);
console.log(`| tool reported an error | ${results.filter((r) => r.ok && r.isError).length} |`);
console.log(`| transport or protocol failure | ${results.filter((r) => !r.ok).length} |`);

console.log(`\n| Shape | Called | Answered | Median bytes | Median ms |`);
console.log("|---|---|---|---|---|");
for (const [shape] of by((r) => r.shape)) {
  const rs = results.filter((r) => r.shape === shape);
  const good = rs.filter((r) => r.ok && !r.isError);
  const med = (xs: number[]) => (xs.length === 0 ? 0 : xs.sort((a, b) => a - b)[Math.floor(xs.length / 2)]!);
  console.log(`| ${shape} | ${rs.length} | ${good.length} | ${med(good.map((r) => r.responseBytes))} | ${med(good.map((r) => r.elapsedMs))} |`);
}

const withSchema = results.filter((r) => r.matchesOutputSchema !== null);
if (withSchema.length > 0) {
  console.log(`\noutputSchema declared on ${withSchema.length} called tools; honoured by ${withSchema.filter((r) => r.matchesOutputSchema === true).length}`);
}
console.log(`\nFailure reasons:`);
for (const [reason, n] of by((r) => (r.ok ? null : (r.reason ?? "unknown")))) {
  if (reason !== null) console.log(`  ${String(n).padStart(3)}  ${String(reason).slice(0, 70)}`);
}
console.log(`\nWrote tool-calls.json`);
