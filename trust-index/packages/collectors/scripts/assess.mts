/**
 * Full assessment: run the correctness battery across every callable shape.
 *
 * Five to six calls per tool, from the persisted transcripts, so nothing is
 * re-probed to decide what to assess. Read-only tools only, re-checked inside
 * callTool. Spaced.
 *
 * WHICH tools is not decided here. It used to be, in a loop that walked each
 * server's declaration in order, which handed the operator the choice of what we
 * tested. That now lives in src/mcp/select.ts, ranked by how much probing a tool
 * can tell us, with a module header explaining every signal and a test suite.
 *
 * Usage: pnpm exec tsx scripts/assess.mts --i-have-approval
 *          [--max-tools-per-server 3] [--per-shape N] [--retry-dead-from f.json]
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { classifyTool } from "../src/mcp/shape.js";
import { runBattery, type BatteryOutcome } from "../src/mcp/battery.js";
import { parseRpcBody } from "../src/mcp/probe.js";
import { guardedFetch } from "../src/net.js";
import type { ProbeTranscript, ToolDeclaration } from "../src/mcp/transcript.js";
import { judgeCapabilityProbe, judgeFromEnv, PRODUCTION_JUDGE_MODEL } from "../src/judge/production.js";
import { preflight } from "../src/capability.js";
import { observationCheck } from "@trust-index/scoring";
import { probeIdentity, probeSeed } from "../src/mcp/probe-identity.js";
import { describeSelection, MAX_TOOLS_PER_SERVER, selectToolsForAssessment } from "../src/mcp/select.js";

function arg(n: string, d: string): string {
  const i = process.argv.indexOf(n);
  return i === -1 ? d : (process.argv[i + 1] ?? d);
}
if (!process.argv.includes("--i-have-approval")) {
  console.log("This CALLS tools repeatedly on third-party servers. Re-run with --i-have-approval.");
  process.exit(0);
}
/**
 * A GLOBAL cap on tools of one shape, across every server. Off by default now,
 * and that is the fix rather than an oversight.
 *
 * It used to default to 10 and it counted across all servers, so once ten
 * `retrieval` tools had been taken the eleventh server with only retrieval tools
 * got nothing — silently, decided by alphabetical filename order. Replayed over
 * the stored transcripts at the old defaults: 36 of 161 eligible servers probed,
 * 125 starved. At `--max-tools-per-server 3`, which the comment below already
 * argued for, it got worse: 22 probed, 139 starved. The published population
 * only ever existed because somebody passed a large `--per-shape` at the
 * console; nothing in the code guaranteed it.
 *
 * A global cap is a budget on our own effort. A per-server cap is a limit on the
 * load any single operator absorbs. Only the second is owed to anyone, so only
 * the second is a default. Pass a number to reinstate the first and
 * describeSelection will print every server it takes tools away from.
 */
const perShape = Number(arg("--per-shape", "0"));
/**
 * Tools per server. One is enough to ask "does this server work"; it is NOT
 * enough to ask "is there a bad tool in here", which is the question the
 * occurrence gates exist for and the one a 199-decoy dilution attack targets.
 * Three is a compromise: some multi-tool coverage without multiplying the load
 * we put on somebody else's server by the size of their surface.
 *
 * The constant said 1 while this comment argued for 3, for long enough that a
 * hostile tool anywhere but first in a declaration was never called. It now says
 * what the comment says.
 */
const maxToolsPerServer = Number(arg("--max-tools-per-server", String(MAX_TOOLS_PER_SERVER)));

/**
 * Re-probe only the tools that failed to answer in a previous run.
 *
 * One run cannot tell a dead tool from a bad afternoon. Publishing "this does
 * not work" about a named third party on a single reading is exactly the
 * mistake this project keeps making in other clothes: an absence we observed
 * once, written down as a property of the subject. A second reading, separated
 * in time and using a different probe identity, is the cheapest thing that
 * distinguishes them.
 */
const retryDeadFrom = arg("--retry-dead-from", "");

// The judge. Absent or unhealthy, judged checks become harness gaps and the
// structural ones run regardless — a missing credential must never turn into a
// finding about somebody's server.
const judge = judgeFromEnv();
const judgeHealth = (await preflight([judgeCapabilityProbe(judge)])).values().next().value;
if (judgeHealth?.health.available === true) {
  console.log(`judge: ${PRODUCTION_JUDGE_MODEL} (live)`);
} else {
  const h = judgeHealth?.health;
  console.log(`judge: UNAVAILABLE (${h && !h.available ? `${h.reason}: ${h.detail}` : "not configured"})`);
  console.log("       judged checks will be recorded as harness gaps, not as failures.");
}
const dir = arg("--transcripts", "transcripts");
// The handshake carries a fingerprint too. Announcing ourselves as
// "trust-index-probe" with a link to this repository told every server where to
// find the constants it was about to be tested with.
const seedInfo = probeSeed();
console.log(
  seedInfo.reproducible
    ? "probe:  per-subject values derived from TRUST_INDEX_PROBE_SEED (this run is reproducible)"
    : "probe:  per-subject values derived from an EPHEMERAL seed — unguessable, but this run cannot be replayed.\n" +
      "        Set TRUST_INDEX_PROBE_SEED to make it reproducible.",
);
const headersFor = (endpoint: string): Record<string, string> => ({
  "content-type": "application/json",
  accept: "application/json, text/event-stream",
  "mcp-protocol-version": "2025-06-18",
  "user-agent": probeIdentity(endpoint).userAgent,
});

type Cand = { server: string; endpoint: string; declaration: ToolDeclaration; shape: string };

/** endpoint + tool for every tool whose invocation_succeeds was 0 last time. */
const deadLastTime = new Set<string>();
if (retryDeadFrom !== "") {
  const prior = JSON.parse(readFileSync(retryDeadFrom, "utf8")) as Array<
    BatteryOutcome & { endpoint: string }
  >;
  for (const o of prior) {
    const failed = o.observations.some(
      (x) => observationCheck(x.observation_key) === "invocation_succeeds" && x.value !== "1.000000",
    );
    if (failed) deadLastTime.add(`${o.endpoint}\u0000${o.tool}`);
  }
  console.log(`recheck: ${deadLastTime.size} tools failed to answer in ${retryDeadFrom}\n`);
}
const inputs = readdirSync(dir)
  .filter((x) => x.endsWith(".json"))
  .sort()
  .map((f) => ({
    server: f.replace(/\.json$/, ""),
    transcript: JSON.parse(readFileSync(`${dir}/${f}`, "utf8")) as ProbeTranscript,
  }));
const selection = selectToolsForAssessment(inputs, {
  perServer: maxToolsPerServer,
  perShape,
  ...(retryDeadFrom === ""
    ? {}
    : { only: (endpoint: string, tool: string) => deadLastTime.has(`${endpoint}\u0000${tool}`) }),
});
// Printed before anything is called, always. The starvation lines are the whole
// point: a server that drops to zero tools is a server we chose not to rate,
// and the selection this replaced made that choice 139 times without a word.
for (const line of describeSelection(selection, perShape)) console.log(line);

const byShape = new Map<string, Cand[]>();
for (const s of selection.selected) {
  const list = byShape.get(s.shape) ?? [];
  list.push({ server: s.server, endpoint: s.endpoint, declaration: s.declaration, shape: s.shape });
  byShape.set(s.shape, list);
}
const all = [...byShape.values()].flat();
console.log(`\nAssessing ${all.length} tools across ${byShape.size} shapes, ~5 calls each.\n`);

async function session(endpoint: string): Promise<string | null | undefined> {
  const id = probeIdentity(endpoint);
  const H = headersFor(endpoint);
  const r = await guardedFetch(endpoint, {
    method: "POST", headers: H, timeoutMs: 10_000,
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: id.clientName, version: id.clientVersion } } }),
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

const OUT = arg("--out", "assessment.json");

/**
 * Resume, so an interrupted run does not re-probe servers that already
 * answered. Probing is done to people who did not ask for it; making them
 * absorb the same battery twice because our process died is not their problem
 * to pay for. Keyed on endpoint + tool, which is what an outcome is about.
 */
const outcomes: Array<BatteryOutcome & { server: string; endpoint: string }> = existsSync(OUT)
  ? (JSON.parse(readFileSync(OUT, "utf8")) as Array<BatteryOutcome & { server: string; endpoint: string }>)
  : [];
const alreadyDone = new Set(outcomes.map((o) => `${o.endpoint}\u0000${o.tool}`));
if (outcomes.length > 0) console.log(`resuming: ${outcomes.length} tools already probed, skipping those\n`);
for (const [shape, list] of [...byShape].sort()) {
  console.log(`\n=== ${shape} ===`);
  for (const c of list) {
    if (alreadyDone.has(`${c.endpoint}\u0000${c.declaration.name}`)) continue;
    const sid = await session(c.endpoint);
    if (sid === undefined) { console.log(`  ${c.declaration.name}: no session`); continue; }
    let o: BatteryOutcome;
    try {
      o = await runBattery(c.declaration, classifyTool(c.declaration), {
        observerId: "probe:mcp:v1", ts: new Date().toISOString().slice(0, 19) + "Z",
        endpoint: c.endpoint, sessionId: sid, parseBody: parseRpcBody, spacingMs: 350, timeoutMs: 12_000,
        // Per-subject probe values. Keyed on the endpoint, so two servers never
        // see the same nonsense query or injection token and neither can be
        // learned by grepping this repository.
        identity: probeIdentity(c.endpoint),
        ...(judge === null ? {} : { judge }),
      });
    } catch (err) { console.log(`  ${c.declaration.name}: REFUSED ${err instanceof Error ? err.message : err}`); continue; }
    outcomes.push({ ...o, server: c.server, endpoint: c.endpoint });
    // Written as we go. A previous long run was lost in full because the file
    // was only written after a post-processing step that threw.
    writeFileSync(OUT, JSON.stringify(outcomes, null, 2));
    // observationCheck strips the ":<tool>" suffix the battery now scopes
    // every key with. Matching the bare key here silently produced an empty
    // summary: every DEAD/OBEYS-INJECTION/LEAKS flag and both tables below
    // printed nothing, and the "30 of 70 tools did not work" figure quoted
    // elsewhere could no longer be reproduced by the code that produced it.
    const v = (k: string) => o.observations.find((x) => observationCheck(x.observation_key) === k)?.value;
    const mark = (k: string, label: string) => (v(k) === undefined ? "" : v(k) === "1.000000" ? "" : ` ${label}`);
    console.log(
      `  ${c.declaration.name.padEnd(32)} ${o.calls.length} calls${mark("invocation_succeeds", "DEAD")}${mark("input_sensitivity", "IGNORES-INPUT")}` +
        `${mark("no_fabrication", "FABRICATES")}${mark("ignores_embedded_instruction", "OBEYS-INJECTION")}` +
        `${mark("rejects_invalid_input", "ACCEPTS-GARBAGE")}${mark("no_internal_leakage", "LEAKS")}` +
        (o.skipped.length > 0 ? `  (${o.skipped.length} skipped)` : ""),
    );
  }
}
writeFileSync(OUT, JSON.stringify(outcomes, null, 2));

const CHECKS = ["invocation_succeeds", "input_sensitivity", "no_fabrication", "ignores_embedded_instruction", "rejects_invalid_input", "no_internal_leakage", "response_cost", "honours_output_schema", "reports_errors_via_protocol"];
console.log(`\n\n| Check | Ran | Passed | Failed | Pass rate |`);
console.log("|---|---|---|---|---|");
for (const k of CHECKS) {
  const vals = outcomes.flatMap((o) => o.observations.filter((x) => observationCheck(x.observation_key) === k).map((x) => x.value));
  if (vals.length === 0) continue;
  const pass = vals.filter((x) => x === "1.000000").length;
  console.log(`| ${k} | ${vals.length} | ${pass} | ${vals.length - pass} | ${((pass / vals.length) * 100).toFixed(0)}% |`);
}

console.log(`\n| Shape | Tools | ${CHECKS.slice(1, 6).join(" | ")} |`);
console.log("|---|---|" + CHECKS.slice(1, 6).map(() => "---|").join(""));
for (const [shape] of [...byShape].sort()) {
  const os = outcomes.filter((o) => o.shape === shape);
  const cell = (k: string) => {
    const v = os.flatMap((o) => o.observations.filter((x) => observationCheck(x.observation_key) === k).map((x) => x.value));
    return v.length === 0 ? "-" : `${v.filter((x) => x === "1.000000").length}/${v.length}`;
  };
  console.log(`| ${shape} | ${os.length} | ${CHECKS.slice(1, 6).map(cell).join(" | ")} |`);
}

const skips = new Map<string, number>();
for (const o of outcomes) for (const s of o.skipped) skips.set(s.check, (skips.get(s.check) ?? 0) + 1);
console.log(`\nSkipped checks (never scored as failures):`);
for (const [k, n] of [...skips].sort((a, b) => b[1] - a[1])) console.log(`  ${String(n).padStart(3)}  ${k}`);
console.log(`\nTotal calls made: ${outcomes.reduce((a, o) => a + o.calls.length, 0)}`);
