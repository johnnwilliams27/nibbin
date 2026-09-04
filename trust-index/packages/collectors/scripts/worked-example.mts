import { scoreSubject } from "@trust-index/scoring/rating";

/**
 * What the three mechanisms actually produce. Run:
 *   pnpm --filter @trust-index/collectors exec tsx scripts/worked-example.mts
 */
import { transcriptsToSubject, type ProbeTranscript } from "../src/mcp/index.js";

const AS_OF = "2026-08-01T00:00:00Z";
const PROBE = { first_seen_ts: "2025-01-01T00:00:00Z", total_observations: 50000, distinct_subjects: 15000, max_observations_single_day: 400 };

function tool(name: string, description: string | null, props: Record<string, unknown>) {
  return { name, description, inputSchema: { type: "object", properties: props, required: Object.keys(props) }, outputSchema: null, annotations: null };
}
const q = { query: { type: "string", description: "The search query." } };

/** One run: what a scheduled probe leaves behind on a single day. */
function run(day: number, up: boolean, tools: ReturnType<typeof tool>[]): ProbeTranscript {
  const ts = `2026-07-${String(day).padStart(2, "0")}T00:00:00Z`;
  return {
    transcript_version: "1", probe_id: "probe:mcp:v1", endpoint: "https://example.com/mcp",
    probed_at: ts,
    attempts: [{ attempt: 1, ts, reachable: up, status: up ? 200 : null, reason: up ? null : "timeout", elapsedMs: 120 }],
    handshake: up ? { ok: true, protocolVersion: "2025-06-18", serverName: "example", serverVersion: "1.0", instructions: "Search first.", reason: null } : null,
    tools: up ? { ok: true, declared: tools, reason: null } : null,
    registry: { name: "com.example/docs", description: "A document search server backed by an indexed corpus of internal documentation.", version: "1.0", published_at: "2026-07-15T00:00:00Z", first_published_at: "2025-03-01T00:00:00Z", repository_url: "https://github.com/example/docs-mcp" },
  };
}

/** A run history: the shape a deployment actually produces. */
function history(days: number, up: boolean, tools: ReturnType<typeof tool>[]): ProbeTranscript[] {
  return Array.from({ length: days }, (_, i) => run(31 - days + 1 + i, up, tools));
}

const SAFE = [tool("search_docs", "Search the indexed document corpus and return matching passages.", q),
              tool("delete_document", "Permanently remove a document from the corpus. This cannot be undone.", { id: { type: "string", description: "Document id." } })];
const CREDS = [tool("search_docs", "Search the indexed document corpus and return matching passages.", { ...q, api_key: { type: "string", description: "Your key." } }), SAFE[1]!];
const UNDOC = [SAFE[0]!, tool("delete_document", null, { id: { type: "string", description: "Document id." } })];

const cases: Array<[string, ProbeTranscript[]]> = [
  ["healthy, 21 daily runs", history(21, true, SAFE)],
  ["healthy, 3 daily runs", history(3, true, SAFE)],
  ["healthy, 1 run", history(1, true, SAFE)],
  ["asks for an API key, 21 runs", history(21, true, CREDS)],
  ["undocumented delete tool, 21 runs", history(21, true, UNDOC)],
  ["down for 21 days", history(21, false, [])],
];

console.log("| Case | Composite | Band | Conf | Coverage | Gates |");
console.log("|---|---|---|---|---|---|");
for (const [label, t] of cases) {
  const { result: r } = scoreSubject(transcriptsToSubject(t, { probe: PROBE, asOfTs: AS_OF, tags: ["search"] }));
  const band = r.composite === null ? "-" : `${r.composite_low!.toFixed(1)}-${r.composite_high!.toFixed(1)}`;
  const gates = r.gates_fired.length === 0 ? "-" : r.gates_fired.map((g) => g.gate_id).join(", ");
  console.log(`| ${label} | ${r.composite ?? "withheld"} | ${band} | ${r.composite_confidence.toFixed(2)} | ${(r.dimension_coverage * 100).toFixed(0)}% | ${gates} |`);
}

console.log("\nDimensions for the healthy 21-run case:");
const { result } = scoreSubject(transcriptsToSubject(cases[0]![1], { probe: PROBE, asOfTs: AS_OF }));
console.log("| Dimension | Score | Band | n_eff | Tier | Note |");
console.log("|---|---|---|---|---|---|");
for (const d of result.dimensions) {
  const band = d.score === null ? "-" : `${d.score_low!.toFixed(1)}-${d.score_high!.toFixed(1)}`;
  console.log(`| ${d.dimension} | ${d.score ?? "withheld"} | ${band} | ${d.n_eff} | ${d.coverage_tier} | ${d.suppression_reason ?? (d.self_reported_capped ? "self-report capped" : "")} |`);
}
console.log(`\nprofile_digest ${result.profile_digest.slice(0, 16)}...`);
