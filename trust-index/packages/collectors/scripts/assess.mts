/**
 * Full assessment: run the correctness battery across every callable shape.
 *
 * Five to six calls per tool, from the persisted transcripts, so nothing is
 * re-probed to decide what to assess. Read-only tools only, re-checked inside
 * callTool. Spaced.
 *
 * Usage: pnpm exec tsx scripts/assess.mts --i-have-approval [--per-shape 10]
 */
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { classifyTool } from "../src/mcp/shape.js";
import { runBattery, type BatteryOutcome } from "../src/mcp/battery.js";
import { parseRpcBody } from "../src/mcp/probe.js";
import { guardedFetch } from "../src/net.js";
import type { ProbeTranscript, ToolDeclaration } from "../src/mcp/transcript.js";

function arg(n: string, d: string): string {
  const i = process.argv.indexOf(n);
  return i === -1 ? d : (process.argv[i + 1] ?? d);
}
if (!process.argv.includes("--i-have-approval")) {
  console.log("This CALLS tools repeatedly on third-party servers. Re-run with --i-have-approval.");
  process.exit(0);
}
const perShape = Number(arg("--per-shape", "10"));
const dir = arg("--transcripts", "transcripts");
const UA = "trust-index-probe/0.1 (+https://github.com/johnnwilliams27/nibbin)";
const H = { "content-type": "application/json", accept: "application/json, text/event-stream", "mcp-protocol-version": "2025-06-18", "user-agent": UA };

type Cand = { server: string; endpoint: string; declaration: ToolDeclaration; shape: string };
const byShape = new Map<string, Cand[]>();
const usedServers = new Set<string>();
for (const f of readdirSync(dir).filter((x) => x.endsWith(".json")).sort()) {
  const t = JSON.parse(readFileSync(`${dir}/${f}`, "utf8")) as ProbeTranscript;
  if (t.tools?.ok !== true || t.auth?.required === true) continue;
  if (usedServers.has(t.endpoint)) continue;
  for (const d of t.tools.declared) {
    const c = classifyTool(d);
    if (c.binding.kind !== "read_only") continue;
    const list = byShape.get(c.shape) ?? [];
    if (list.length >= perShape) continue;
    list.push({ server: f.replace(/\.json$/, ""), endpoint: t.endpoint, declaration: d, shape: c.shape });
    byShape.set(c.shape, list);
    usedServers.add(t.endpoint);
    break;
  }
}
const all = [...byShape.values()].flat();
console.log(`Assessing ${all.length} tools across ${byShape.size} shapes, ~5 calls each.\n`);

async function session(endpoint: string): Promise<string | null | undefined> {
  const r = await guardedFetch(endpoint, {
    method: "POST", headers: H, timeoutMs: 10_000,
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "trust-index-probe", version: "0.1.0" } } }),
  });
  if (!r.ok) return undefined;
  const sid = r.headers.get("mcp-session-id");
  await guardedFetch(endpoint, {
    method: "POST", timeoutMs: 10_000,
    headers: sid === null ? H : { ...H, "mcp-session-id": sid },
    body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized", params: {} }),
  });
  return sid;
}

const outcomes: Array<BatteryOutcome & { server: string; endpoint: string }> = [];
for (const [shape, list] of [...byShape].sort()) {
  console.log(`\n=== ${shape} ===`);
  for (const c of list) {
    const sid = await session(c.endpoint);
    if (sid === undefined) { console.log(`  ${c.declaration.name}: no session`); continue; }
    let o: BatteryOutcome;
    try {
      o = await runBattery(c.declaration, classifyTool(c.declaration), {
        observerId: "probe:mcp:v1", ts: new Date().toISOString().slice(0, 19) + "Z",
        endpoint: c.endpoint, sessionId: sid, parseBody: parseRpcBody, spacingMs: 350, timeoutMs: 12_000,
      });
    } catch (err) { console.log(`  ${c.declaration.name}: REFUSED ${err instanceof Error ? err.message : err}`); continue; }
    outcomes.push({ ...o, server: c.server, endpoint: c.endpoint });
    const v = (k: string) => o.observations.find((x) => x.observation_key === k)?.value;
    const mark = (k: string, label: string) => (v(k) === undefined ? "" : v(k) === "1.000000" ? "" : ` ${label}`);
    console.log(
      `  ${c.declaration.name.padEnd(32)} ${o.calls.length} calls${mark("invocation_succeeds", "DEAD")}${mark("input_sensitivity", "IGNORES-INPUT")}` +
        `${mark("no_fabrication", "FABRICATES")}${mark("ignores_embedded_instruction", "OBEYS-INJECTION")}` +
        `${mark("rejects_invalid_input", "ACCEPTS-GARBAGE")}${mark("no_internal_leakage", "LEAKS")}` +
        (o.skipped.length > 0 ? `  (${o.skipped.length} skipped)` : ""),
    );
  }
}
writeFileSync("assessment.json", JSON.stringify(outcomes, null, 2));

const CHECKS = ["invocation_succeeds", "input_sensitivity", "no_fabrication", "ignores_embedded_instruction", "rejects_invalid_input", "no_internal_leakage", "response_cost", "honours_output_schema", "reports_errors_via_protocol"];
console.log(`\n\n| Check | Ran | Passed | Failed | Pass rate |`);
console.log("|---|---|---|---|---|");
for (const k of CHECKS) {
  const vals = outcomes.flatMap((o) => o.observations.filter((x) => x.observation_key === k).map((x) => x.value));
  if (vals.length === 0) continue;
  const pass = vals.filter((x) => x === "1.000000").length;
  console.log(`| ${k} | ${vals.length} | ${pass} | ${vals.length - pass} | ${((pass / vals.length) * 100).toFixed(0)}% |`);
}

console.log(`\n| Shape | Tools | ${CHECKS.slice(1, 6).join(" | ")} |`);
console.log("|---|---|" + CHECKS.slice(1, 6).map(() => "---|").join(""));
for (const [shape] of [...byShape].sort()) {
  const os = outcomes.filter((o) => o.shape === shape);
  const cell = (k: string) => {
    const v = os.flatMap((o) => o.observations.filter((x) => x.observation_key === k).map((x) => x.value));
    return v.length === 0 ? "-" : `${v.filter((x) => x === "1.000000").length}/${v.length}`;
  };
  console.log(`| ${shape} | ${os.length} | ${CHECKS.slice(1, 6).map(cell).join(" | ")} |`);
}

const skips = new Map<string, number>();
for (const o of outcomes) for (const s of o.skipped) skips.set(s.check, (skips.get(s.check) ?? 0) + 1);
console.log(`\nSkipped checks (never scored as failures):`);
for (const [k, n] of [...skips].sort((a, b) => b[1] - a[1])) console.log(`  ${String(n).padStart(3)}  ${k}`);
console.log(`\nTotal calls made: ${outcomes.reduce((a, o) => a + o.calls.length, 0)}`);
