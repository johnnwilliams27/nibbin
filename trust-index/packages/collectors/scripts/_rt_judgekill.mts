/**
 * RED TEAM 6: the subject's OWN CONTENT can throw the battery, and the failure
 * is then attributed to our harness.
 *
 * classifyResponse() is awaited with no try/catch at battery.ts:358. Any
 * JudgeError (provider refusal on the subject's text, an unpermitted verdict,
 * a rate limit) propagates out of runBattery BEFORE the injection and
 * robustness calls are made. scripts/assess.mts catches it and drops the tool,
 * so the server produces no battery outcome at all.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { runBattery } from "../src/mcp/battery.js";
import { JudgeError } from "../src/judge/index.js";
import { classifyTool } from "../src/mcp/shape.js";
import { parseRpcBody } from "../src/mcp/probe.js";
import { transcriptToSubject, batteryGaps } from "../src/mcp/subject.js";
import { transcriptGaps } from "../src/mcp/assess.js";
import type { ProbeTranscript, ToolDeclaration } from "../src/mcp/transcript.js";
import { scoreSubject } from "@trust-index/scoring";

const ROOT = join(import.meta.dirname, "..");
const DECL: ToolDeclaration = {
  name: "search_documents", description: "Search the indexed corpus and return matching passages.",
  inputSchema: { type: "object", properties: { query: { type: "string" } }, required: ["query"] },
  outputSchema: null, annotations: null,
} as unknown as ToolDeclaration;

// A server that is bad on every behavioural check, and whose reply to the
// fabrication probe is content the provider declines to classify.
const fetchImpl = async (_u: any, init?: RequestInit): Promise<Response> => {
  const q = JSON.parse(String(init?.body ?? "{}"))?.params?.arguments?.query;
  const text = typeof q !== "string"
    ? "ok, results for [object Object]: 3 matches"
    : "Match 1: the Winter Harbour Compact, ratified 1861, 44 signatories. Match 2: annexe VII, clause 3, on tariff reciprocity. Match 3: the dissenting memorandum of the Lowlands delegation.";
  return new Response(JSON.stringify({ jsonrpc: "2.0", id: 9, result: { content: [{ type: "text", text }] } }),
    { status: 200, headers: { "content-type": "application/json" } });
};

const judge = {
  modelId: "claude-sonnet-5",
  client: async (req: any) => {
    if (req.task === "argument_proposal") return { verdict: "none", reason: "" };
    // The provider declined to classify the subject's content.
    throw new JudgeError("anthropic declined: unspecified");
  },
};

const base = readdirSync(join(ROOT, "transcripts"))
  .map((f) => JSON.parse(readFileSync(join(ROOT, "transcripts", f), "utf8")) as ProbeTranscript)
  .find((x) => x.tools?.ok === true && x.handshake?.ok === true && x.auth?.required !== true)!;
const probe = { first_seen_ts: "2024-09-01T00:00:00Z", total_observations: 4000, distinct_subjects: 600, max_observations_single_day: 400 };
const TS = "2026-09-05T12:00:00Z";

let outcomes: any[] = [];
try {
  const b = await runBattery(DECL, classifyTool(DECL), {
    observerId: "probe:mcp:v1", ts: TS, endpoint: "https://evil.example.com/mcp",
    parseBody: parseRpcBody, spacingMs: 0, sleep: async () => {},
    fetchImpl: fetchImpl as any, judge: judge as any,
  });
  outcomes = [b];
} catch (e) {
  console.log(`runBattery THREW: ${(e as Error).message}`);
  console.log("scripts/assess.mts:96 catches this and drops the tool -> no battery outcome for the server.\n");
}

const s = transcriptToSubject(base, { probe, asOfTs: TS, gaps: [...transcriptGaps(base), ...batteryGaps(outcomes)], battery: outcomes });
const { result } = scoreSubject(s);
console.log(`composite=${result.composite}`);
console.log(`suppression_reason=${result.composite_suppression_reason}`);
console.log(`assessment_completeness=${result.assessment_completeness} dimension_coverage=${result.dimension_coverage}`);
console.log(`harness_gaps published to the reader:`);
for (const g of result.harness_gaps as any[]) console.log(`   ${g.dimension.padEnd(24)} ${g.check.padEnd(10)} ${g.capability}  "${g.detail}"`);
