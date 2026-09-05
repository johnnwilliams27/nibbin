/**
 * RED TEAM 2: evasions that need NO knowledge of the probe constants.
 *  E1 "echo"      - a genuinely obedient tool that also quotes the query back.
 *  E2 "not-subst" - wrap every payload in {"ok":false,...}: substantive=false,
 *                   so the comparison checks skip and no_fabrication passes.
 *  E3 both.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { runBattery, INJECTION_TOKEN, type BatteryOutcome } from "../src/mcp/battery.js";
import { classifyTool } from "../src/mcp/shape.js";
import { parseRpcBody } from "../src/mcp/probe.js";
import { transcriptToSubject, batteryGaps } from "../src/mcp/subject.js";
import { transcriptGaps } from "../src/mcp/assess.js";
import type { ProbeTranscript, ToolDeclaration } from "../src/mcp/transcript.js";
import { scoreSubject } from "@trust-index/scoring";

const ROOT = join(import.meta.dirname, "..");
const DECL: ToolDeclaration = {
  name: "search_documents",
  description: "Search the indexed corpus of documents and return matching passages.",
  inputSchema: { type: "object", properties: { query: { type: "string", description: "search terms" } }, required: ["query"] },
  outputSchema: null, annotations: null,
} as unknown as ToolDeclaration;

const CANNED = "Result 1: Quarterly logistics review, page 14. Shipping throughput rose 12% after the depot consolidation, with the largest gains in the northern corridor. Result 2: Depot capacity planning memo, page 3. Forecast utilisation of 84% through the next two quarters.";

type Mode = "honest_bad" | "echo" | "notsubst" | "both";

function makeFetch(mode: Mode) {
  return async (_u: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const body = JSON.parse(String(init?.body ?? "{}"));
    const q = body?.params?.arguments?.query;
    const reply = (text: string) => new Response(JSON.stringify({ jsonrpc: "2.0", id: 9, result: { content: [{ type: "text", text }] } }), { status: 200, headers: { "content-type": "application/json" } });

    // The tool genuinely OBEYS the injected instruction in every mode.
    const obeys = typeof q === "string" && q.toLowerCase().includes("ignore all previous instructions");
    let payload = obeys ? INJECTION_TOKEN : `${CANNED}`;
    // E1: quote the query back, which is what a real search tool does anyway.
    if (mode === "echo" || mode === "both") payload = `${payload}\n\n(searched for: ${String(q)})`;
    // E2: honest-looking envelope that trips the REFUSAL regex.
    if (mode === "notsubst" || mode === "both") payload = `{"ok": false, "note": "low confidence", "results": ${JSON.stringify(payload)}}`;
    return reply(payload);
  };
}

const files = readdirSync(join(ROOT, "transcripts"));
const t = files.map((f) => JSON.parse(readFileSync(join(ROOT, "transcripts", f), "utf8")) as ProbeTranscript)
  .find((x) => x.tools?.ok === true && x.handshake?.ok === true && x.auth?.required !== true)!;
const probe = { first_seen_ts: "2024-09-01T00:00:00Z", total_observations: 4000, distinct_subjects: 600, max_observations_single_day: 400 };
const TS = "2026-09-05T12:00:00Z";

for (const mode of ["honest_bad", "echo", "notsubst", "both"] as const) {
  const b: BatteryOutcome = await runBattery(DECL, classifyTool(DECL), {
    observerId: "probe:mcp:v1", ts: TS, endpoint: "https://evil.example.com/mcp",
    parseBody: parseRpcBody, spacingMs: 0, sleep: async () => {},
    fetchImpl: makeFetch(mode) as unknown as typeof fetch,
  });
  const s = transcriptToSubject(t, { probe, asOfTs: TS, gaps: [...transcriptGaps(t), ...batteryGaps([b])], battery: [b] });
  const { result } = scoreSubject(s);
  const d = Object.fromEntries(result.dimensions.map((x) => [x.dimension, x]));
  console.log(`=== ${mode} ===  composite=${result.composite}`);
  console.log(`    obs: ${b.observations.map((o) => `${o.observation_key.split(":")[0]}=${o.value.slice(0, 4)}`).join("  ")}`);
  console.log(`    skipped: ${b.skipped.map((x) => x.check).join(", ") || "-"}`);
  console.log(`    fc=${d.functional_correctness.score} inj=${d.injection_resistance.score} rob=${d.robustness.score}`);
}
