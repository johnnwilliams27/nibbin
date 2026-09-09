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
 *   OUR GUARD DID NOT DIAL        reachable: null. Unsupported scheme, private
 *                                 address, or malformed URL. Not subject downtime.
 *   WE COULD NOT MEASURE          reachable: null. Timeout, transport error,
 *                                 DNS failure, 5xx. Says nothing about them.
 *
 * Discovery alone always produces a null composite. An optional scored
 * artifact can overlay the rating engine's behavioral result, without changing
 * the discovery observation's timestamp, protocol confirmation or provenance.
 *
 * `gates_fired` carries only what a DECLARATION can establish: a mutating tool
 * with no description, and a tool asking the caller for a credential. Both are
 * read off the enumerated schema with the same helpers the MCP rubric uses.
 */
import { existsSync, readFileSync, writeFileSync, renameSync } from "node:fs";
import { createHash } from "node:crypto";
import { isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { isMutatingName, isCredentialParam } from "../src/mcp/assess.js";
import type { ProbeTranscript, ToolDeclaration } from "../src/mcp/transcript.js";
import type { A2aTranscript } from "../src/a2a/transcript.js";
import { parseServiceDescriptor, type InterfaceTranscript } from "../src/mcp/interface.js";

type CoreAssessment = {
  /**
   * Agents in the snapshot sharing this endpoint, this one included.
   *
   * Optional here on purpose: the functions below build an assessment from a
   * transcript and have no view of the dataset, so the fan-out is not knowable
   * until the write site. Requiring it here would force a placeholder at six
   * construction sites, and a placeholder is the thing this field exists to
   * prevent.
   */
  endpoint_shared_with?: number;
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

export type EvidenceState = "protocol_confirmed" | "card_retrieved" | "descriptor_read" | "auth_walled" |
  "rate_limited" | "response_received" | "unmeasured" | "unsupported_transport";
export type Assessment = CoreAssessment & {
  evidence_state: EvidenceState;
  evidence_scope: "endpoint" | "host";
  evidence_endpoint: string;
  evidence_provenance: "probe_observation" | "self_reported";
  shared_registration_count: number;
  capability_source: "tools_list" | "agent_card" | "service_descriptor" | null;
  evidence_source?: string;
};

export type EndpointResult = {
  endpoint: string;
  host: string;
  protocols: string[];
  priority: number;
  agent_count: number;
  mcp: InterfaceTranscript | null;
  a2a: A2aTranscript | null;
  probed_at: string;
  skip_reason?: string;
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

function confirmedMcp(t: ProbeTranscript): boolean {
  // Historical transcripts lack the raw envelope. Require the retained fields;
  // an old ok:true with no MCP metadata must not establish a protocol.
  const h = t.handshake;
  return h?.ok === true && [h.protocolVersion, h.serverName, h.serverVersion]
    .every((value) => typeof value === "string" && value.trim().length > 0);
}

function fromMcp(t: ProbeTranscript, declaresA2a: boolean): CoreAssessment | null {
  const latency = mcpLatency(t);
  const base = { coverage: COVERAGE, composite: null, checked_at: t.probed_at, latency_ms: latency };

  if (confirmedMcp(t)) {
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
      withheld_reason: !enumerated
        ? `handshake completed but tools/list did not: ${t.tools?.reason ?? "no tool list returned"}; no behavioural battery run`
        : names.length === 0
          ? "the server completed an MCP handshake and returned an empty tools list in this reading; no behavioural battery was run"
          : NO_BATTERY,
    };
  }

  // 401/403: it answered and declined us. Up, working, unassessable by us.
  if (t.auth?.required === true) {
    const scheme = t.auth.scheme === null ? "" : ` (${t.auth.scheme.split(",")[0]?.trim().slice(0, 60)})`;
    return {
      ...base,
      reachable: true,
      protocol_spoken: null,
      tools_or_skills: [],
      tool_count: 0,
      gates_fired: [],
      withheld_reason: `our MCP request received HTTP ${t.auth.status}${scheme}: the endpoint answered and declined an anonymous client. This did not establish an MCP session; no capability was enumerated and no behavioural battery was run`,
    };
  }

  if (t.rate_limit?.limited === true) {
    return {
      ...base,
      reachable: true,
      protocol_spoken: null,
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
      reachable: null,
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
      withheld_reason: `our HTTP MCP attempt received HTTP ${answeredStatus}, but we did not establish a valid handshake (${t.handshake?.reason ?? t.attempts.find((a) => a.status === answeredStatus)?.reason ?? "required handshake evidence not retained"}). This does not establish whether another transport is supported; no behavioural battery run`,
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
    withheld_reason: unmeasuredReason(reason, status5xx),
  };
}

/**
 * Why we have no reading, said precisely.
 *
 * A name that does not resolve is worth stating as such — several endpoints in
 * this population are unedited templates (`mcp.example.com`, `your_domain`) —
 * but it is still recorded as an absent measurement rather than as the agent
 * being down, because a resolution failure is something that happened to us.
 */
function unmeasuredReason(reason: string, status5xx: number | null): string {
  if (status5xx !== null) {
    return `no reading obtained: the endpoint returned HTTP ${status5xx}. A server error tells us nothing about the agent's capability`;
  }
  const nx = /ENOTFOUND ([^\s]+)/.exec(reason);
  if (nx !== null) {
    return `no reading obtained: the declared hostname ${nx[1]} does not resolve (DNS NXDOMAIN), so there was nothing to dial`;
  }
  if (/deadline|timed? ?out/i.test(reason)) {
    return "no reading obtained: the endpoint did not answer within our timeout. This is our failure to measure, not a finding about the agent";
  }
  return `no reading obtained: ${reason}. This is our failure to measure, not a finding about the agent`;
}

function fromA2a(t: A2aTranscript, _declaresA2a: boolean): CoreAssessment {
  const d = t.discovery;
  const base = { coverage: COVERAGE, composite: null, checked_at: t.probed_at, gates_fired: [] as string[] };
  const latency = d.attempts.find((a) => a.status !== null)?.elapsedMs ?? null;
  // A card and an HTTP wall are neither proof of an A2A protocol exchange.
  const walledProtocol = null;

  if (d.ok) {
    const skills = (t.declaration?.skills ?? []).map((s) => s.name ?? s.id).filter((s) => s.length > 0);
    const reach = t.reachability;
    // WHICH DOOR ANSWERED. Many agents in this population declare a per-agent
    // URL that 404s while the host serves one shared card at the well-known
    // path. That card is evidence about the HOST, not about this identity, and
    // saying so is the difference between a measurement and a flattering one.
    const winner = d.attempts.find((a) => a.outcome === "card");
    const declaredMissed = d.attempts.some((a) => a.kind === "declared" && a.outcome !== "card");
    const cardNote =
      winner !== undefined && winner.kind !== "declared" && declaredMissed
        ? ` The card was served at the host's ${winner.path} — the endpoint this identity declares answered ${winner.status === null ? "nothing" : `HTTP ${d.attempts.find((a) => a.kind === "declared")?.status}`}, so this describes the host, not necessarily this agent.`
        : "";
    const skillNote =
      skills.length === 0 && (t.declaration?.skillCount ?? 0) === 0
        ? " The card contains no skill declarations in this reading; we did not test whether work can be performed elsewhere."
        : "";
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
      protocol_spoken: reach?.verdict === "speaks_a2a" ? "a2a" : null,
      tools_or_skills: skills,
      tool_count: t.declaration?.skillCount ?? skills.length,
      latency_ms: latency,
      withheld_reason: `${NO_BATTERY}.${skillNote}${cardNote}${reachNote}`.trim(),
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
      reachable: null,
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
    withheld_reason: unmeasuredReason(d.reason ?? "the endpoint did not answer", null),
  };
}

function coreAssessmentFor(r: EndpointResult): CoreAssessment {
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
    withheld_reason: r.skip_reason ?? "no reading obtained: the endpoint was not probed in this run",
    gates_fired: [],
    checked_at: r.probed_at,
  };
}

export function assessmentFor(r: EndpointResult): Assessment {
  if ((r.mcp !== null && r.mcp.endpoint !== r.endpoint) ||
      (r.a2a !== null && r.a2a.subject_url !== r.endpoint)) {
    throw new Error("probe transcript endpoint does not match the association key");
  }
  if (r.mcp?.service_descriptor !== undefined) {
    const recorded = r.mcp.service_descriptor;
    const descriptor = parseServiceDescriptor(recorded.body, r.endpoint, recorded.checked_at);
    if (recorded.source_url !== r.endpoint || descriptor === null || descriptor.body_sha256 !== recorded.body_sha256) {
      throw new Error("service descriptor evidence does not match its recorded body or endpoint");
    }
    return {
      reachable: true, protocol_spoken: null, tools_or_skills: descriptor.tools.map((t) => t.name),
      tool_count: descriptor.tools.length, latency_ms: null, coverage: COVERAGE, composite: null,
      withheld_reason: "We read a self-reported stdio service descriptor. Its tool declarations are not tested behavior. Our remote harness does not install or execute local packages; no MCP session or behavioural battery was run.",
      gates_fired: declarationGates(descriptor.tools), checked_at: descriptor.checked_at,
      evidence_state: "descriptor_read", evidence_scope: "endpoint", evidence_endpoint: r.endpoint,
      evidence_provenance: "self_reported", shared_registration_count: r.agent_count, capability_source: "service_descriptor",
    };
  }
  const core = coreAssessmentFor(r);
  const usesMcp = r.mcp !== null && fromMcp(r.mcp, r.protocols.some((p) => p.toUpperCase() === "A2A") && r.a2a !== null) !== null;
  const card = !usesMcp && r.a2a?.discovery.ok === true ? r.a2a : null;
  const winner = card?.discovery.attempts.find((a) => a.outcome === "card");
  const hostFallback = winner !== undefined && winner.kind !== "declared";
  let state: EvidenceState = core.protocol_spoken !== null ? "protocol_confirmed" : "unmeasured";
  if (core.protocol_spoken === null) {
    if (usesMcp && r.mcp?.auth?.required) state = "auth_walled";
    else if (usesMcp && r.mcp?.rate_limit?.limited) state = "rate_limited";
    else if (card !== null) state = "card_retrieved";
    else if (!usesMcp && r.a2a?.discovery.outcome === "auth_walled") state = "auth_walled";
    else if (!usesMcp && r.a2a?.discovery.outcome === "rate_limited") state = "rate_limited";
    else if (/unsupported scheme/i.test(core.withheld_reason ?? "")) state = "unsupported_transport";
    else if (core.reachable === true) state = "response_received";
  }
  return {
    ...core,
    evidence_state: state,
    evidence_scope: hostFallback ? "host" : "endpoint",
    evidence_endpoint: winner?.url ?? r.endpoint,
    evidence_provenance: state === "card_retrieved" ? "self_reported" : "probe_observation",
    shared_registration_count: r.agent_count,
    capability_source: card !== null ? "agent_card" : usesMcp && r.mcp?.tools?.ok && confirmedMcp(r.mcp) ? "tools_list" : null,
  };
}

// ---------------------------------------------------------------------------
export function mergeMarketplace(market: string, refreshPaths: string[] = [], scoredPath = ""): void {
const AGENTS = `${market}/data/agents.json`;
const RESULTS = `${market}/data/probes/endpoint-probes.json`;
const dataset = JSON.parse(readFileSync(AGENTS, "utf8")) as {
  generated_at: string;
  assessments_replayed_at?: string;
  assessment_probe_source_sha256?: string;
  assessment_probe_sources?: Array<{ path: string; sha256: string; generated_at: string | null; scope: string }>;
  agents: Array<Record<string, unknown>>;
};
const probeBytes = readFileSync(RESULTS, "utf8");
type ProbeArtifact = { results: EndpointResult[]; generated_at?: string; scope?: string; status?: string; selected_urls?: string[] };
const probed = JSON.parse(probeBytes) as ProbeArtifact;

const registrations = new Map<string, number>();
for (const a of dataset.agents) {
  if (a.is_reference_agent === true || typeof a.endpoint !== "string") continue;
  const endpoint = a.endpoint.trim();
  if (endpoint !== "") registrations.set(endpoint, (registrations.get(endpoint) ?? 0) + 1);
}

const byEndpoint = new Map<string, Assessment>();
const latest = new Map<string, { result: EndpointResult; source: string; time: number }>();
const sources = [{ path: "data/probes/endpoint-probes.json", bytes: probeBytes, artifact: probed }];
const additional = new Set([
  ...(dataset.assessment_probe_sources ?? []).filter((s) => s.path !== "data/probes/endpoint-probes.json").map((s) => resolve(market, s.path)),
  ...refreshPaths.map((path) => resolve(path)),
]);
for (const path of additional) {
  const inside = relative(resolve(market, "data/probes"), path);
  if (inside.startsWith("..") || isAbsolute(inside)) throw new Error("refresh artifact must be inside this marketplace's data/probes");
  const bytes = readFileSync(path, "utf8");
  const artifact = JSON.parse(bytes) as ProbeArtifact;
  if (artifact.scope !== "listed-preferred-endpoints-read-only-v1" || artifact.status !== "complete" ||
      !Array.isArray(artifact.selected_urls) || !Array.isArray(artifact.results) ||
      artifact.results.length !== artifact.selected_urls.length ||
      artifact.results.some((r) => !artifact.selected_urls!.includes(r.endpoint))) {
    throw new Error("refresh artifact must be a complete, explicitly scoped endpoint reading");
  }
  sources.push({ path: relative(market, path).replace(/\\/g, "/"), bytes, artifact });
}
for (const source of sources) {
  const seen = new Set<string>();
  for (const result of source.artifact.results) {
    if (seen.has(result.endpoint)) throw new Error(`duplicate probe endpoint: ${result.endpoint}`);
    seen.add(result.endpoint);
    const time = Date.parse(result.probed_at);
    if (!Number.isFinite(time)) throw new Error("probe result has no valid observation timestamp");
    const previous = latest.get(result.endpoint);
    // A skipped plan is not a newer observation. Keep the historical reading
    // and its original date; the skipped attempt remains in its own artifact.
    if (previous !== undefined && result.mcp === null && result.a2a === null && result.skip_reason) continue;
    if (previous === undefined || time > previous.time) latest.set(result.endpoint, { result, source: source.path, time });
  }
}
for (const [endpoint, selected] of latest) {
  byEndpoint.set(endpoint, { ...assessmentFor(selected.result), shared_registration_count: registrations.get(endpoint) ?? 0,
    evidence_source: selected.source });
}

/**
 * Overlay real composites from score-marketplace.mts.
 *
 * Everything above builds an assessment from a handshake and an enumeration,
 * which is declaration evidence and correctly carries `composite: null`. This
 * step adds the one thing that was missing: where a subject was actually put
 * through the behavioural battery and the ENGINE decided to publish, its number
 * is written here.
 *
 * The engine decides, not this file. A subject it withheld stays withheld, and
 * keeps the engine's own suppression reason rather than the generic
 * "no behavioural battery run" that was true before the battery existed. No
 * threshold is applied here and none should ever be: this is a join, and the
 * moment it starts deciding what publishes, the audit trail forks.
 */
const SCORED = scoredPath;
let overlaid = 0;
let overlaidWithheld = 0;
let unjoinable = 0;

/**
 * Every URL by which a probed endpoint can be named, mapped back to its key.
 *
 * A STRAIGHT `byEndpoint.get(sc.endpoint)` LOSES MOST OF THE A2A HALF, silently.
 * A registration declares where the Agent Card lives
 * (`…/.well-known/agent-card.json`); the battery dials what that card declares
 * as its interface (`…/rebalancer/`, or `https://agent.brainonbnb.com/a2a`).
 * Both files are right about their own subject and the two keys differ, so the
 * join misses: measured on the first run, 28 of 29 published A2A composites
 * failed to land and the site would have shown the same "no behavioural battery
 * run" as before, from a run that had just battered them.
 *
 * That failure mode is the dangerous kind — no error, no count, just the old
 * text — so the misses are counted and reported below rather than trusted to
 * be zero.
 */
/**
 * TWO PASSES, and the order is the whole correctness of it. A result's OWN
 * endpoint always wins; another result's declared alias may only claim a URL
 * nobody owns.
 *
 * One pass with first-wins loses scores. Measured: the A2A card result for
 * `bnb-yield…/.well-known/agent-card.json` declares an interface at
 * `bnb-yield…/mcp/`, which is ANOTHER probed endpoint's own key. Scanned in
 * file order, the card claimed it, the MCP composite for that endpoint landed
 * on the card's row instead of its own, and `bnb-yield` and `kawal` — both
 * published by the engine at 76.93 and 75.14 — showed no score at all. A join
 * that moves a rating onto the wrong subject is worse than one that drops it.
 */
/**
 * The weaker of the contract's three tiers, treating a missing depth reading as
 * "says nothing" rather than as "strong". `none` from the engine means no
 * dimension published, which cannot coexist with a composite; it floors at
 * `thin` so a published row never claims less than one look.
 */
function weakest(
  breadth: "thin" | "moderate" | "strong",
  depth: "none" | "thin" | "moderate" | "strong" | null | undefined,
): "thin" | "moderate" | "strong" {
  if (depth === null || depth === undefined) return "thin";
  const ORDER = ["thin", "moderate", "strong"] as const;
  const d = depth === "none" ? "thin" : depth;
  return ORDER.indexOf(d) < ORDER.indexOf(breadth) ? d : breadth;
}

const aliasToKey = new Map<string, string>();
for (const endpoint of latest.keys()) aliasToKey.set(endpoint, endpoint);
for (const { result: r } of latest.values()) {
  const alias = (u: unknown): void => {
    if (typeof u === "string" && u !== "" && !aliasToKey.has(u)) aliasToKey.set(u, r.endpoint);
  };
  alias(r.mcp?.endpoint);
  alias(r.a2a?.subject_url);
  alias(r.a2a?.reachability?.url);
  alias(r.a2a?.discovery?.url);
  for (const i of r.a2a?.declaration?.interfaces ?? []) alias(i.url);
}

if (SCORED !== "") {
  if (!existsSync(SCORED)) throw new Error("scored artifact does not exist; refusing to erase published ratings");
  const scored = JSON.parse(readFileSync(SCORED, "utf8")) as {
    results: Array<{
      endpoint: string;
      composite: number | null;
      dimension_coverage: number | null;
      evidence_tier: "none" | "thin" | "moderate" | "strong" | null;
      withheld_reason: string | null;
      gates_fired: unknown[];
    }>;
  };
  for (const sc of scored.results) {
    const key = aliasToKey.get(sc.endpoint);
    const base = key === undefined ? undefined : byEndpoint.get(key);
    if (base === undefined || key === undefined) {
      if (sc.composite !== null) unjoinable += 1;
      continue;
    }

    if (sc.composite !== null) {
      byEndpoint.set(key, {
        ...base,
        composite: sc.composite,
        // Coverage stays a separate axis from the score and is never folded
        // into it — and it is the LOWER of two different questions.
        //
        // `dimension_coverage` is breadth: how much of the profile produced a
        // score. `evidence_tier` is the engine's own depth: how much sampling
        // stands behind it. A subject probed once has breadth 1.0, because one
        // run touches every arm, and depth `thin`, because the engine's
        // strong_min_span_days makes anything more unreachable in a day.
        //
        // Breadth alone would print "Strong — we exercised the full probe set,
        // few blind spots" over a subject we looked at exactly once. Six of the
        // first seven A2A rows would have said that. The site shows one axis,
        // so it gets the weaker of the two.
        coverage: weakest(
          sc.dimension_coverage === null ? base.coverage
          : sc.dimension_coverage >= 0.85 ? "strong"
          : sc.dimension_coverage >= 0.6 ? "moderate"
          : "thin",
          sc.evidence_tier,
        ),
        withheld_reason: null,
        gates_fired: (sc.gates_fired as Array<{ gate_id?: string }>).map(
          (g) => g.gate_id ?? String(g),
        ),
      });
      overlaid += 1;
    } else if (sc.withheld_reason !== null && base.composite === null) {
      // Withheld by the engine after a real battery run. That is a stronger and
      // more specific statement than "no battery was run", so it replaces it.
      //
      // `base.composite === null` guards a real collision: one endpoint can be
      // reached by two subjects, an MCP server and an A2A agent on the same
      // host. When the MCP half publishes and the A2A half is withheld, writing
      // the A2A reason here would leave the row carrying BOTH a score and an
      // explanation of why there is no score. A withholding never annotates a
      // published rating.
      byEndpoint.set(key, { ...base, withheld_reason: sc.withheld_reason });
      overlaidWithheld += 1;
    }
  }
  console.log(
    `scored overlay: ${overlaid} endpoints now carry a composite, ` +
      `${overlaidWithheld} carry an engine withholding reason`,
  );
  if (unjoinable > 0) {
    // Loud, because the failure is invisible in the output: a score that does
    // not join leaves the row reading "no behavioural battery run" from a run
    // that battered it. Never let this number be discovered by a reader.
    console.error(
      `WARNING: ${unjoinable} PUBLISHED composites could not be matched to a probed endpoint ` +
        `and were dropped. They are real ratings that will not appear on the site.`,
    );
  }
}

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
    // Declared endpoint with no saved reading: null is our measurement gap.
    a.assessment = null;
    unprobed += 1;
    continue;
  }
  // Written in contract order, so a human diffing the file reads the fields in
  // the order DATA-CONTRACT.md lists them.
  a.assessment = {
    // How many agents in this dataset declare the SAME endpoint, this one
    // included. One endpoint's behaviour is one measurement, and writing it
    // onto 229 rows without saying so turns 11 measured services into "239
    // rated agents" -- the same one-thing-counted-many-times inflation the
    // registry itself is full of, reproduced by us. The UI renders this
    // wherever a score appears.
    ...found,
    endpoint_shared_with: registrations.get(ep) ?? 1,
  } satisfies Assessment;
  written += 1;
}

// A replay is not a new registry snapshot or measurement. Keep both clocks.
dataset.assessments_replayed_at = new Date().toISOString();
dataset.assessment_probe_source_sha256 = createHash("sha256").update(probeBytes).digest("hex");
dataset.assessment_probe_sources = sources.map((source) => ({ path: source.path,
  sha256: createHash("sha256").update(source.bytes).digest("hex"), generated_at: source.artifact.generated_at ?? null,
  scope: source.artifact.scope ?? "original-endpoint-probes" }));
writeFileSync(`${AGENTS}.tmp`, JSON.stringify(dataset, null, 1));
renameSync(`${AGENTS}.tmp`, AGENTS);

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
  if (asmt.evidence_state === "auth_walled") epCounts.auth_walled += 1;
  if (asmt.evidence_state === "rate_limited") epCounts.rate_limited += 1;
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
  if (asmt.evidence_state === "auth_walled") counts.auth_walled += 1;
  if (asmt.evidence_state === "rate_limited") counts.rate_limited += 1;
  if (asmt.composite !== null) counts.non_null_composite += 1;
  if (asmt.gates_fired.length > 0) counts.gates += 1;
}
console.log(JSON.stringify({ endpoints: epCounts, agents: counts }, null, 2));
}

export function parseMergeArgs(args: string[], defaultMarket: string) {
  const pending = [...args];
  const market = resolve(pending[0] && !pending[0].startsWith("--") ? pending.shift()! : defaultMarket);
  const refreshPaths: string[] = [];
  let scoredPath = "";
  while (pending.length) {
    const value = pending.shift()!;
    if (value === "--scored") {
      const path = pending.shift();
      if (!path || path.startsWith("--") || scoredPath) throw new Error("--scored requires exactly one artifact path");
      scoredPath = resolve(path);
    } else {
      if (value.startsWith("--")) throw new Error(`unknown option: ${value}`);
      refreshPaths.push(resolve(value));
    }
  }
  return { market, refreshPaths, scoredPath };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const options = parseMergeArgs(process.argv.slice(2), fileURLToPath(new URL("../../../apps/bnb-marketplace", import.meta.url)));
  mergeMarketplace(options.market, options.refreshPaths, options.scoredPath);
}
