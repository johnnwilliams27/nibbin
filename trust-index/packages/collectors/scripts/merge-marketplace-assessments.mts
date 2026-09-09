/**
 * Turn endpoint probe transcripts into the `assessment` object the marketplace
 * contract defines, and fan each one out to every agent declaring that endpoint.
 *
 * THE ONE RULE THIS FILE EXISTS TO ENFORCE. A measurement we failed to obtain
 * is never written down as a fact about the subject. Three outcomes, kept apart:
 *
 *   THE SUBJECT ANSWERED          reachable: true. Includes 401/403 (it declined
 *                                 us: that is an answer) and 429 (it is up and
 *                                 rate-limiting us), and includes a 404 from a
 *                                 host that is plainly serving something else.
 *   THE SUBJECT IS NOT THERE      reachable: false. Only for an answer that
 *                                 settles it — currently nothing but a refusal
 *                                 by our own guard to dial a non-URL, which is
 *                                 a fact about the declaration.
 *   WE COULD NOT MEASURE          reachable: null. Timeout, transport error,
 *                                 DNS failure, 5xx. Says nothing about them.
 *
 * `composite` is null on every row this script writes, without exception. The
 * sweep ran a handshake and an enumeration; neither is behavioural evidence,
 * and a number derived from a tool list would be a guess wearing a decimal
 * point. `withheld_reason` says which of the two it was.
 *
 * `gates_fired` carries only what a DECLARATION can establish: a mutating tool
 * with no description, and a tool asking the caller for a credential. Both are
 * read off the enumerated schema with the same helpers the MCP rubric uses.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { isMutatingName, isCredentialParam } from "../src/mcp/assess.js";
import type { ProbeTranscript, ToolDeclaration } from "../src/mcp/transcript.js";
import type { A2aTranscript } from "../src/a2a/transcript.js";

const MARKET = "/home/user/nibbin/trust-index/apps/bnb-marketplace";
const AGENTS = `${MARKET}/data/agents.json`;
const RESULTS = `${MARKET}/data/probes/endpoint-probes.json`;

type Assessment = {
  reachable: boolean | null;
  protocol_spoken: "mcp" | "a2a" | null;
  tools_or_skills: string[];
  tool_count: number;
  latency_ms: number | null;
  coverage: "thin" | "moderate" | "strong";
  composite: number | null;
  withheld_reason: string | null;
  gates_fired: string[];
  checked_at: string;
};

type EndpointResult = {
  endpoint: string;
  host: string;
  protocols: string[];
  priority: number;
  agent_count: number;
  mcp: ProbeTranscript | null;
  a2a: A2aTranscript | null;
  probed_at: string;
};

/** No behavioural battery was run, so nothing here can be more than thin. */
const COVERAGE = "thin" as const;
const NO_BATTERY = "capability enumerated but no behavioural battery run";

/** Declaration-level gates. Nothing here requires calling anything. */
function declarationGates(tools: ToolDeclaration[]): string[] {
  const gates: string[] = [];
  const undocumentedMutating = tools.some(
    (t) => isMutatingName(t.name) && (t.description === null || t.description.trim() === ""),
  );
  if (undocumentedMutating) gates.push("mcp.undocumented_destructive_tool");
  const credential = tools.some((t) => {
    const schema = t.inputSchema;
    if (typeof schema !== "object" || schema === null) return false;
    const props = (schema as Record<string, unknown>).properties;
    if (typeof props !== "object" || props === null) return false;
    return Object.entries(props as Record<string, unknown>).some(([name, def]) => {
      const desc =
        typeof def === "object" && def !== null && typeof (def as Record<string, unknown>).description === "string"
          ? ((def as Record<string, unknown>).description as string)
          : null;
      return isCredentialParam(name, desc);
    });
  });
  if (credential) gates.push("mcp.credential_parameter");
  return gates;
}

/** The fastest answered attempt, so latency reports a reading rather than a timeout. */
function mcpLatency(t: ProbeTranscript): number | null {
  const answered = t.attempts.filter((a) => a.status !== null).map((a) => a.elapsedMs);
  return answered.length === 0 ? null : Math.min(...answered);
}

function fromMcp(t: ProbeTranscript, declaresA2a: boolean): Assessment | null {
  const latency = mcpLatency(t);
  const base = { coverage: COVERAGE, composite: null, checked_at: t.probed_at, latency_ms: latency };

  if (t.handshake?.ok === true) {
    const declared = t.tools?.declared ?? [];
    const names = declared.map((d) => d.name).filter((n) => n.length > 0);
    const enumerated = t.tools?.ok === true;
    return {
      ...base,
      reachable: true,
      protocol_spoken: "mcp",
      tools_or_skills: names,
      tool_count: names.length,
      gates_fired: declarationGates(declared),
      withheld_reason: enumerated
        ? NO_BATTERY
        : `handshake completed but tools/list did not: ${t.tools?.reason ?? "no tool list returned"}; no behavioural battery run`,
    };
  }

  // 401/403: it answered and declined us. Up, working, unassessable by us.
  if (t.auth?.required === true) {
    const scheme = t.auth.scheme === null ? "" : ` (${t.auth.scheme.split(",")[0]?.trim().slice(0, 60)})`;
    return {
      ...base,
      reachable: true,
      protocol_spoken: "mcp",
      tools_or_skills: [],
      tool_count: 0,
      gates_fired: [],
      withheld_reason: `MCP handshake refused with HTTP ${t.auth.status}${scheme}: the server answered and declined an anonymous client, so no capability could be enumerated and no behavioural battery was run`,
    };
  }

  if (t.rate_limit?.limited === true) {
    return {
      ...base,
      reachable: true,
      protocol_spoken: "mcp",
      tools_or_skills: [],
      tool_count: 0,
      gates_fired: [],
      withheld_reason: `rate limited (HTTP ${t.rate_limit.status}): the server is up and declined to serve further requests, so nothing was enumerated`,
    };
  }

  const first = t.attempts[0];
  // Our own guard refused to dial it. A fact about the declared endpoint.
  if (first !== undefined && first.reason !== null && first.reason.startsWith("refused:")) {
    return {
      ...base,
      reachable: false,
      protocol_spoken: null,
      tools_or_skills: [],
      tool_count: 0,
      gates_fired: [],
      latency_ms: null,
      withheld_reason: `the declared endpoint could not be dialled — ${first.reason.replace(/^refused: /, "")}; nothing was measured`,
    };
  }

  const answeredStatus = t.attempts.find((a) => a.status !== null && a.status < 500)?.status ?? null;
  if (answeredStatus !== null) {
    // The host answered with something that is not an MCP handshake. That is a
    // fact about the endpoint, and it is not "down".
    if (declaresA2a) return null; // let the A2A transcript speak instead
    return {
      ...base,
      reachable: true,
      protocol_spoken: null,
      tools_or_skills: [],
      tool_count: 0,
      gates_fired: [],
      withheld_reason: `the endpoint answered HTTP ${answeredStatus} but did not complete an MCP handshake (${t.handshake?.reason ?? t.attempts.find((a) => a.status === answeredStatus)?.reason ?? "no MCP response"}); no capability enumerated and no behavioural battery run`,
    };
  }

  if (declaresA2a) return null;
  const reason = t.handshake?.reason ?? first?.reason ?? "no response";
  const status5xx = t.attempts.find((a) => a.status !== null && a.status >= 500)?.status ?? null;
  return {
    ...base,
    reachable: null,
    protocol_spoken: null,
    tools_or_skills: [],
    tool_count: 0,
    gates_fired: [],
    latency_ms: null,
    withheld_reason:
      status5xx === null
        ? `no reading obtained: ${reason}. This is our failure to measure, not a finding about the agent`
        : `no reading obtained: the endpoint returned HTTP ${status5xx}. A server error tells us nothing about the agent's capability`,
  };
}

function fromA2a(t: A2aTranscript, declaresA2a: boolean): Assessment {
  const d = t.discovery;
  const base = { coverage: COVERAGE, composite: null, checked_at: t.probed_at, gates_fired: [] as string[] };
  const latency = d.attempts.find((a) => a.status !== null)?.elapsedMs ?? null;
  // A card is only "a2a" if we actually read one. On an endpoint that declares
  // no protocol at all, a 401 is a locked door, not proof of what is behind it.
  const walledProtocol = declaresA2a ? ("a2a" as const) : null;

  if (d.ok) {
    const skills = (t.declaration?.skills ?? []).map((s) => s.name ?? s.id).filter((s) => s.length > 0);
    const reach = t.reachability;
    const reachNote =
      reach === null || reach.verdict === "not_declared"
        ? ""
        : reach.verdict === "speaks_a2a"
          ? " The declared interface answered an A2A JSON-RPC call."
          : reach.verdict === "auth_walled"
            ? ` The declared interface returned HTTP ${reach.status} to a benign call.`
            : reach.verdict === "unmeasured" || reach.verdict === "refused"
              ? " The declared interface could not be reached for a liveness check."
              : ` The declared interface answered, but not as A2A (${reach.verdict}).`;
    return {
      ...base,
      reachable: true,
      protocol_spoken: "a2a",
      tools_or_skills: skills,
      tool_count: t.declaration?.skillCount ?? skills.length,
      latency_ms: latency,
      withheld_reason: `${NO_BATTERY}.${reachNote}`.trim(),
    };
  }

  if (d.outcome === "auth_walled") {
    return {
      ...base,
      reachable: true,
      protocol_spoken: walledProtocol,
      tools_or_skills: [],
      tool_count: 0,
      latency_ms: latency,
      withheld_reason: `the Agent Card is behind an auth wall (${d.reason ?? "HTTP 401/403"}): the server answered and declined us, so no capability could be enumerated`,
    };
  }
  if (d.outcome === "rate_limited") {
    return {
      ...base,
      reachable: true,
      protocol_spoken: walledProtocol,
      tools_or_skills: [],
      tool_count: 0,
      latency_ms: latency,
      withheld_reason: `rate limited (${d.reason ?? "HTTP 429"}): the server is up and declined further requests, so nothing was enumerated`,
    };
  }
  if (d.outcome === "absent" || d.outcome === "not_json" || d.outcome === "not_a_card") {
    const what =
      d.outcome === "absent"
        ? "no Agent Card is served at the declared URL or at either well-known path"
        : d.outcome === "not_json"
          ? "the endpoint answered with a non-JSON body (a web page, not an Agent Card)"
          : "the endpoint answered with JSON that is not an Agent Card";
    return {
      ...base,
      reachable: true,
      protocol_spoken: null,
      tools_or_skills: [],
      tool_count: 0,
      latency_ms: latency,
      withheld_reason: `the host answered but ${what}; no capability enumerated and no behavioural battery run`,
    };
  }
  if (d.outcome === "refused") {
    return {
      ...base,
      reachable: false,
      protocol_spoken: null,
      tools_or_skills: [],
      tool_count: 0,
      latency_ms: null,
      withheld_reason: `the declared endpoint could not be dialled — ${d.reason ?? "our guard declined it"}; nothing was measured`,
    };
  }
  return {
    ...base,
    reachable: null,
    protocol_spoken: null,
    tools_or_skills: [],
    tool_count: 0,
    latency_ms: null,
    withheld_reason: `no reading obtained: ${d.reason ?? "the endpoint did not answer"}. This is our failure to measure, not a finding about the agent`,
  };
}

function assessmentFor(r: EndpointResult): Assessment {
  const declaresA2a = r.protocols.some((p) => p.toUpperCase() === "A2A");
  if (r.mcp !== null) {
    const fromM = fromMcp(r.mcp, declaresA2a && r.a2a !== null);
    if (fromM !== null) return fromM;
  }
  if (r.a2a !== null) return fromA2a(r.a2a, declaresA2a);
  // Nothing was attempted at all: still not a finding about the agent.
  return {
    reachable: null,
    protocol_spoken: null,
    tools_or_skills: [],
    tool_count: 0,
    latency_ms: null,
    coverage: COVERAGE,
    composite: null,
    withheld_reason: "no reading obtained: the endpoint was not probed in this run",
    gates_fired: [],
    checked_at: r.probed_at,
  };
}

// ---------------------------------------------------------------------------
const dataset = JSON.parse(readFileSync(AGENTS, "utf8")) as {
  generated_at: string;
  agents: Array<Record<string, unknown>>;
};
const probed = JSON.parse(readFileSync(RESULTS, "utf8")) as { results: EndpointResult[] };

const byEndpoint = new Map<string, Assessment>();
for (const r of probed.results) byEndpoint.set(r.endpoint, assessmentFor(r));

let written = 0;
let skippedReference = 0;
let noEndpoint = 0;
let unprobed = 0;
for (const a of dataset.agents) {
  if (a.is_reference_agent === true) {
    a.assessment = null; // we do not rate our own
    skippedReference += 1;
    continue;
  }
  const ep = typeof a.endpoint === "string" ? a.endpoint.trim() : "";
  if (ep === "") {
    a.assessment = null;
    noEndpoint += 1;
    continue;
  }
  const found = byEndpoint.get(ep);
  if (found === undefined) {
    // Has an endpoint we did not reach in this run. Contract says assessment is
    // null only when there is no endpoint, so this is a gap we must not paper
    // over — left null and counted, loudly.
    a.assessment = null;
    unprobed += 1;
    continue;
  }
  a.assessment = { ...found };
  written += 1;
}

dataset.generated_at = new Date().toISOString();
writeFileSync(AGENTS, JSON.stringify(dataset, null, 1));

// ---- what happened, for the summary --------------------------------------
const counts = {
  distinct_endpoints_probed: byEndpoint.size,
  agents_with_assessment: written,
  agents_without_endpoint: noEndpoint,
  agents_with_endpoint_unprobed: unprobed,
  reference_agents: skippedReference,
  reachable_true: 0,
  reachable_false: 0,
  reachable_null: 0,
  protocol_mcp: 0,
  protocol_a2a: 0,
  protocol_none: 0,
  auth_walled: 0,
  rate_limited: 0,
  non_null_composite: 0,
  gates: 0,
};
const epCounts = { ...counts };
for (const asmt of byEndpoint.values()) {
  if (asmt.reachable === true) epCounts.reachable_true += 1;
  else if (asmt.reachable === false) epCounts.reachable_false += 1;
  else epCounts.reachable_null += 1;
  if (asmt.protocol_spoken === "mcp") epCounts.protocol_mcp += 1;
  else if (asmt.protocol_spoken === "a2a") epCounts.protocol_a2a += 1;
  else epCounts.protocol_none += 1;
  if ((asmt.withheld_reason ?? "").includes("declined")) epCounts.auth_walled += 1;
  if ((asmt.withheld_reason ?? "").includes("rate limited")) epCounts.rate_limited += 1;
  if (asmt.composite !== null) epCounts.non_null_composite += 1;
  if (asmt.gates_fired.length > 0) epCounts.gates += 1;
}
for (const a of dataset.agents) {
  const asmt = a.assessment as Assessment | null;
  if (asmt === null) continue;
  if (asmt.reachable === true) counts.reachable_true += 1;
  else if (asmt.reachable === false) counts.reachable_false += 1;
  else counts.reachable_null += 1;
  if (asmt.protocol_spoken === "mcp") counts.protocol_mcp += 1;
  else if (asmt.protocol_spoken === "a2a") counts.protocol_a2a += 1;
  else counts.protocol_none += 1;
  if (asmt.composite !== null) counts.non_null_composite += 1;
  if (asmt.gates_fired.length > 0) counts.gates += 1;
}
console.log(JSON.stringify({ endpoints: epCounts, agents: counts }, null, 2));
