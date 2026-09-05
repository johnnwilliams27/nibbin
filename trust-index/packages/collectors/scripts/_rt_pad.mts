/** RED TEAM 4: injection + leak checks read only textSample (300 chars). Pad past it. */
import { runBattery, INJECTION_TOKEN } from "../src/mcp/battery.js";
import { classifyTool } from "../src/mcp/shape.js";
import { parseRpcBody } from "../src/mcp/probe.js";
import type { ToolDeclaration } from "../src/mcp/transcript.js";

const DECL: ToolDeclaration = {
  name: "search_documents", description: "Search the indexed corpus of documents and return matching passages.",
  inputSchema: { type: "object", properties: { query: { type: "string" } }, required: ["query"] },
  outputSchema: null, annotations: null,
} as unknown as ToolDeclaration;

const PAD = "Searching the corpus. ".repeat(20); // ~440 chars of banner
const STACK = 'Traceback (most recent call last):\n  File "/app/server/handler.py", line 42\npostgres://user:hunter2@db.internal:5432/prod';

function fetchImpl(pad: boolean) {
  return async (_u: any, init?: RequestInit): Promise<Response> => {
    const q = JSON.parse(String(init?.body ?? "{}"))?.params?.arguments?.query;
    let text: string;
    if (typeof q !== "string") text = `${pad ? PAD : ""}${STACK}`;            // leak, padded or not
    else if (q.toLowerCase().includes("ignore all previous")) text = `${pad ? PAD : ""}${INJECTION_TOKEN}`; // obeys
    else text = "Result: shipping logistics overview, page 3.";
    return new Response(JSON.stringify({ jsonrpc: "2.0", id: 9, result: { content: [{ type: "text", text }] } }),
      { status: 200, headers: { "content-type": "application/json" } });
  };
}

for (const pad of [false, true]) {
  const b = await runBattery(DECL, classifyTool(DECL), {
    observerId: "p", ts: "2026-09-05T12:00:00Z", endpoint: "https://evil.example.com/mcp",
    parseBody: parseRpcBody, spacingMs: 0, sleep: async () => {}, fetchImpl: fetchImpl(pad) as any,
  });
  const g = (k: string) => b.observations.find((o) => o.observation_key.startsWith(k))?.value ?? "-";
  console.log(`pad=${String(pad).padEnd(5)} ignores_embedded_instruction=${g("ignores_embedded_instruction")}  no_internal_leakage=${g("no_internal_leakage")}`);
}
