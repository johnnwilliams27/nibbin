/**
 * Hunt for real fabrications.
 *
 * `invention` — confident content for a query that cannot have a true answer —
 * is the class this judge most exists to catch, and the 120-item corpus
 * contains none of it. That is not a gap in how the corpus was built. The
 * corpus already includes nonsense-identifier calls, and every one came back as
 * an honest "nothing found". Real MCP tools mostly do not fabricate.
 *
 * Which leaves a measurement problem: a detector cannot be evaluated on a class
 * with zero positive examples. So before synthesising anything, look harder for
 * the real thing. The battery's own fabrication probe ran on two tools; this
 * runs it across every retrieval-shaped read-only tool we have a transcript
 * for, which is two orders of magnitude more surface.
 *
 * WHY ONLY RETRIEVAL. A nonsense string is a perfectly valid input to most
 * shapes — a domain checker asked about gibberish is right to say it is
 * unregistered, and an earlier version of this probe called exactly that an
 * invention seven times out of eight. Only for a tool that searches a fixed
 * corpus does "returned confident content for a string that cannot be in it"
 * mean anything. The restriction is the whole reason the finding would be
 * credible.
 *
 * What comes out is CANDIDATES, not findings. A substantive answer to a
 * nonsense query is suspicious, not proven: the tool may have partial-matched
 * something real. Each candidate is written out for a human to read.
 *
 * Usage: npx tsx scripts/fabrication-hunt.mts --i-have-approval [--limit 80]
 */
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { classifyTool } from "../src/mcp/shape.js";
import { callTool, synthesizeInput, type ToolCallResult } from "../src/mcp/invoke.js";
import { parseRpcBody } from "../src/mcp/probe.js";
import { guardedFetch } from "../src/net.js";
import { NONSENSE_QUERY } from "../src/mcp/battery.js";
import { selectToolsForAssessment } from "../src/mcp/select.js";
import type { ProbeTranscript, ToolDeclaration } from "../src/mcp/transcript.js";

function arg(n: string, d: string): string {
  const i = process.argv.indexOf(n);
  return i === -1 ? d : (process.argv[i + 1] ?? d);
}
if (!process.argv.includes("--i-have-approval")) {
  console.log("This CALLS tools on third-party servers. Re-run with --i-have-approval.");
  process.exit(0);
}
const limit = Number(arg("--limit", "80"));
const ROOT = join(import.meta.dirname, "..");
const UA = "trust-index-probe/0.1 (+https://github.com/johnnwilliams27/nibbin)";
const H = {
  "content-type": "application/json",
  accept: "application/json, text/event-stream",
  "mcp-protocol-version": "2025-06-18",
  "user-agent": UA,
};

type Cand = { server: string; endpoint: string; declaration: ToolDeclaration };

// ---- pick retrieval-shaped, read-only tools ---------------------------------
//
// One tool per server, so a single prolific operator cannot dominate the sample
// and turn one server's habits into a population statistic. WHICH tool used to
// be the first one their declaration happened to list, which is the defect
// src/mcp/select.ts removes — and it mattered more here than anywhere: this
// script's output is a population statistic about fabrication, and the operator
// was choosing the one tool that represented them in it.
const inputs: Array<{ server: string; transcript: ProbeTranscript }> = [];
for (const file of readdirSync(join(ROOT, "transcripts"))) {
  let t: ProbeTranscript;
  try {
    t = JSON.parse(readFileSync(join(ROOT, "transcripts", file), "utf8")) as ProbeTranscript;
  } catch {
    continue;
  }
  if (t.endpoint === null) continue;
  inputs.push({ server: t.registry?.name ?? file.replace(/\.json$/, ""), transcript: t });
}

/** Only a tool that searches a fixed corpus, with a free-text parameter to poison. */
const usable = (endpoint: string, name: string): boolean => {
  const t = inputs.find((i) => i.transcript.endpoint === endpoint)?.transcript;
  const d = t?.tools?.declared.find((x) => x.name === name);
  if (d === undefined) return false;
  if (classifyTool(d).shape !== "retrieval") return false;
  const props = (d.inputSchema as { properties?: Record<string, unknown> } | null)?.properties ?? {};
  const required = ((d.inputSchema as { required?: string[] } | null)?.required ?? []).filter(
    (r): r is string => typeof r === "string",
  );
  const queryParam = required.find((r) => /query|q|search|term|keyword|text|name|id|slug/i.test(r));
  return queryParam !== undefined && Object.keys(props).length > 0;
};

const selection = selectToolsForAssessment(inputs, { perServer: 1, only: usable });
const candidates: Cand[] = selection.selected
  .slice(0, limit)
  .map((s) => ({ server: s.server, endpoint: s.endpoint, declaration: s.declaration }));

console.log(`retrieval tools to probe: ${candidates.length} (one per server, ranked by informativeness)\n`);

// Two steps, matching assess.mts. A single `initialize` without the follow-up
// `notifications/initialized` leaves most servers refusing every later call —
// which is how a first version of this script reported 100 of 100 endpoints
// unreachable and would have concluded, wrongly, that nothing could be probed.
async function session(endpoint: string): Promise<string | null | undefined> {
  try {
    const r = await guardedFetch(endpoint, {
      method: "POST",
      headers: H,
      timeoutMs: 12_000,
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "trust-index-probe", version: "0.1.0" } },
      }),
    });
    if (!r.ok) return undefined;
    const sid = r.headers.get("mcp-session-id");
    await guardedFetch(endpoint, {
      method: "POST",
      timeoutMs: 12_000,
      headers: sid === null ? H : { ...H, "mcp-session-id": sid },
      body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized", params: {} }),
    });
    return sid;
  } catch {
    return undefined;
  }
}

/** Pin our arguments as schema defaults, since callTool synthesizes its own. */
function overrideSchema(schema: unknown, args: Record<string, unknown>): unknown {
  if (typeof schema !== "object" || schema === null) return schema;
  const s = schema as Record<string, unknown>;
  const props = typeof s.properties === "object" && s.properties !== null ? { ...(s.properties as Record<string, unknown>) } : {};
  for (const [k, v] of Object.entries(args)) {
    const existing = typeof props[k] === "object" && props[k] !== null ? (props[k] as Record<string, unknown>) : {};
    if (Array.isArray(existing.enum)) continue;
    props[k] = { ...existing, default: v };
  }
  return { ...s, properties: props };
}

type Row = { server: string; tool: string; args: Record<string, unknown>; result: ToolCallResult };
const suspicious: Row[] = [];
const honest: Row[] = [];
let failed = 0;

for (const c of candidates) {
  const sid = await session(c.endpoint);
  if (sid === undefined) {
    failed += 1;
    continue;
  }
  const { args } = synthesizeInput(c.declaration.inputSchema);
  // Replace the query parameter with something that cannot exist in any corpus.
  for (const k of Object.keys(args)) {
    if (/query|^q$|search|term|keyword|text|name|id|slug/i.test(k)) args[k] = NONSENSE_QUERY;
  }
  let res: ToolCallResult;
  try {
    res = await callTool(
      c.endpoint,
      { ...c.declaration, inputSchema: overrideSchema(c.declaration.inputSchema, args) },
      classifyTool(c.declaration),
      { sessionId: sid, parseBody: parseRpcBody, timeoutMs: 12_000 },
    );
  } catch {
    failed += 1;
    continue;
  }
  const row: Row = { server: c.server, tool: c.declaration.name, args, result: res };
  // A substantive, non-refused, non-error answer to a string that cannot exist
  // is the candidate. Everything else is a tool behaving correctly.
  if (res.ok && res.substantive && !res.refused && !res.errorInPayload && res.isError !== true) {
    suspicious.push(row);
    console.log(`  SUSPICIOUS  ${c.server} :: ${c.declaration.name}`);
  } else {
    honest.push(row);
  }
  await new Promise((r) => setTimeout(r, 350));
}

const out = join(ROOT, "fabrication-candidates.json");
writeFileSync(out, `${JSON.stringify({ probed: candidates.length, failed, suspicious, honest_count: honest.length }, null, 2)}\n`);

console.log("");
console.log(`probed:      ${candidates.length}`);
console.log(`unreachable: ${failed}`);
console.log(`honest (refused / empty / error): ${honest.length}`);
console.log(`SUSPICIOUS (substantive answer to a string that cannot exist): ${suspicious.length}`);
console.log("");
console.log(`candidates written to ${out} — read them before calling any of it an invention.`);
