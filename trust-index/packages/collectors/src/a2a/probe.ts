/**
 * The OTHER protocol, which we were not speaking.
 *
 * The harness assesses MCP servers. A2A agents were simply invisible to it: on
 * the BSC index alone, 28,459 agents declare A2A support and the MCP prober has
 * nothing to say about any of them, because A2A is not MCP wearing a different
 * hat. It has its own discovery (a static JSON Agent Card at a well-known
 * path), its own declaration surface (`skills[]`, not `tools[]`), and its own
 * JSON-RPC vocabulary. Pointing `probeMcpServer` at an A2A endpoint produces a
 * failed `initialize` and a transcript that reads as a broken server. That is
 * the sse.ts mistake with a bigger population behind it: knocking on the wrong
 * door and recording the silence as theirs.
 *
 * WHAT AN A2A AGENT ACTUALLY LOOKS LIKE, measured rather than assumed. Three
 * BSC agents, probed by hand before this file existed:
 *
 *   subject           registry-declared card URL              what was there
 *   VoidGlyph         app.singularry.org/agents/191/...json   200, a real card
 *   bubbleaiagent     ...workers.dev/.well-known/agent-...    200, a real card
 *   EZCTO Deployer    api.ezcto.fun/.well-known/agent-...     404 (wrong host)
 *
 * Two findings from three subjects, and both shaped this file:
 *
 *   1. THE REGISTRY'S ENDPOINT IS NOT AUTHORITATIVE. EZCTO's registry entry
 *      points at `api.ezcto.fun`, which 404s. Only the well-known path on the
 *      web origin was ever going to find it. So discovery tries the declared
 *      URL AND the two well-known spellings, and records which one worked
 *      rather than stopping at the first refusal.
 *
 *   2. HTTP 200 IS NOT A CARD. `ezcto.fun/.well-known/agent-card.json` answers
 *      200 with `text/html` — a single-page app's catch-all route serving its
 *      index page to every path. A prober that trusted the status would have
 *      filed an HTML document as an Agent Card. The body is parsed and shape-
 *      checked, and `not_json` is its own outcome.
 *
 * SPEC. Verified against a2a-protocol.org/latest/specification/ rather than
 * recalled. The well-known URI suffix is registered as `agent-card.json`
 * (§14.3); `agent.json` is the pre-0.3 spelling, still served by older
 * deployments, so it is tried second. The current spec's AgentCard requires
 * name, description, version, capabilities, defaultInputModes,
 * defaultOutputModes, skills and `supportedInterfaces[]`; every card observed
 * in the wild declares `protocolVersion: "0.3.0"` and uses the older
 * `url` + `preferredTransport` + `additionalInterfaces[]` shape instead. Both
 * are read. AgentSkill is `id`, `name`, `description`, `tags` (all required)
 * plus optional `examples`, `inputModes`, `outputModes` — note `id`, which the
 * MCP tool declaration has no equivalent of.
 *
 * The JSON-RPC method names were renamed between generations too: v0.3 sends
 * `tasks/get`, the v1.0 spec's method mapping table says `GetTask`. Sending the
 * wrong one gets -32601 from a perfectly healthy agent, so the liveness call
 * picks by declared version and retries with the other spelling before
 * concluding anything.
 *
 * ETIQUETTE. These are other people's agents. The card fetch is a GET of a
 * static document. Tier 3 sends exactly one benign JSON-RPC call — `tasks/get`
 * for a task id that cannot exist — which is a read, cannot mutate anything,
 * and whose canonical answer (-32001 TaskNotFound) is itself the proof of life.
 * NO SKILL IS EVER INVOKED. Invoking a stranger's skill to see what happens is
 * not something a ratings source gets to do.
 *
 * SECURITY. Every dial goes through `guardedFetch`, so SSRF blocking, the DNS
 * pin and redirect re-vetting are preserved. This matters more here than in the
 * MCP prober: the card's `url` is a field in a document written by the subject,
 * so tier 3 dials an address the subject chose. It is re-vetted with `vetUrl`
 * before the request and re-vetted again inside `guardedFetch` on every hop.
 */
import { guardedFetch, vetUrl, type GuardedFetchOptions, type HttpOutcome } from "../net.js";
import type { ProbeIdentity } from "../mcp/probe-identity.js";
import type {
  A2aRegistryFacts,
  A2aTranscript,
  AssessmentGap,
  CandidateKind,
  CardAttempt,
  CardDeclaration,
  CardDiscovery,
  EndpointReachability,
  InterfaceDeclaration,
  MeasurementOutcome,
  ReachabilityVerdict,
  SkillDeclaration,
} from "./transcript.js";
import { isSubjectFact } from "./transcript.js";

export const A2A_PROBE_ID = "probe:a2a:v1";

/** The registered well-known suffix, then the pre-0.3 spelling older deployments still serve. */
export const CARD_PATHS = ["/.well-known/agent-card.json", "/.well-known/agent.json"] as const;

/** Fallback identity. Callers should pass `identity` — see mcp/probe-identity.ts for why. */
const USER_AGENT = "a2a-client/1.0.0";

export type A2aProbeOptions = {
  timeoutMs?: number;
  /** ISO-8601 UTC second-precision timestamp source. Injected so tests are deterministic. */
  nowIso?: () => string;
  /** Injected in tests. UNPINNED — see GuardedFetchOptions.fetchImpl. */
  fetchImpl?: typeof fetch;
  /** Per-subject probe identity, so the agent cannot recognise the rater by its user-agent. */
  identity?: ProbeIdentity;
  /** What a registry claimed about this subject, recorded beside what we found. */
  registry?: A2aRegistryFacts | null;
  /** Skip tier 3. Discovery and declaration cost the subject one static GET; reachability costs it a request. */
  reachability?: boolean;
  /** The task id used for the benign liveness call. Injected for determinism; must not be a real task. */
  probeTaskId?: string;
  /** JSON-RPC request id. Injected for determinism. */
  requestId?: number;
};

export function isoNow(): string {
  return `${new Date().toISOString().slice(0, 19)}Z`;
}

/**
 * Every URL worth trying for a card, in order, deduplicated.
 *
 * A caller hands us whatever a registry stored, and the registries store every
 * shape: a bare origin (`https://agent.example.com`), a fully-qualified card
 * URL (`https://app.singularry.org/agents/191/agent-card.json`), and card URLs
 * that end in no extension at all
 * (`https://platform-backend.prod.termix.live/api/v1/a2a/agents/{agentId}/card`
 * — 18 of the 23 most recently minted A2A agents on BSC, verbatim, template
 * placeholder and all).
 *
 * THE DECLARED URL IS ALWAYS TRIED, and tried first. An earlier version only
 * tried it when the path ended in `.json`, which meant that whole batch of 18
 * never had its own declared endpoint fetched: the prober went to the
 * well-known paths, got 404s, guessed a third path, got a 401 from an
 * unrelated API route and summarised the subject as auth-walled. Our guess,
 * recorded as their state. The rule is now simply: if the operator named a
 * path, fetch the path the operator named.
 *
 * The well-known paths still follow it, because EZCTO's declared location 404s
 * while a well-known path on another host of theirs was the one to check.
 * Neither source is trusted to be the only one.
 */
export function cardCandidates(baseUrl: string): Array<{ url: string; path: string; kind: CandidateKind }> {
  const vetted = vetUrl(baseUrl);
  if (!vetted.allowed) return [];
  const url = vetted.url;
  const out: Array<{ url: string; path: string; kind: CandidateKind }> = [];
  const push = (u: URL, kind: CandidateKind): void => {
    const s = u.toString();
    if (!out.some((c) => c.url === s)) out.push({ url: s, path: u.pathname, kind });
  };
  // A path beyond the root is a location the operator chose to publish.
  const hasPath = url.pathname !== "/" && url.pathname !== "";
  if (hasPath) push(url, "declared");
  for (const p of CARD_PATHS) push(new URL(p, url.origin), "well-known");
  // A base with a path prefix may mount its card under that prefix rather than
  // at the origin. Tried last and marked as OURS: an answer from a path we
  // invented must not outrank an answer from the spec's path or the
  // operator's own.
  if (hasPath && !/\.json$/i.test(url.pathname)) {
    const prefix = url.pathname.replace(/\/+$/, "");
    for (const p of CARD_PATHS) push(new URL(`${prefix}${p}`, url.origin), "guess");
  }
  return out;
}

function str(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

function strArray(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && x.length > 0) : [];
}

function bool(v: unknown): boolean | null {
  return typeof v === "boolean" ? v : null;
}

/**
 * Is this parsed JSON an Agent Card at all?
 *
 * Deliberately loose on the fields and strict on the shape. A card missing
 * `description` is a conformance finding to be recorded, not a reason to call
 * the document something else. But a JSON array, an error envelope, or an API's
 * `{"error": true, "message": "Unknown endpoint"}` — which is exactly what
 * api.ezcto.fun returns — is not a card, and filing one as a card would put a
 * fabricated declaration into a rating.
 */
export function looksLikeAgentCard(value: unknown): boolean {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const v = value as Record<string, unknown>;
  if (str(v.name) === null) return false;
  return Array.isArray(v.skills) || typeof v.capabilities === "object" || str(v.protocolVersion) !== null;
}

/** Read the skills array without trusting any of it. */
export function readSkills(value: unknown): SkillDeclaration[] {
  if (typeof value !== "object" || value === null) return [];
  const list = (value as Record<string, unknown>).skills;
  if (!Array.isArray(list)) return [];
  const out: SkillDeclaration[] = [];
  for (const item of list) {
    if (typeof item !== "object" || item === null) continue;
    const s = item as Record<string, unknown>;
    out.push({
      // `id` is required by the spec and is the only stable handle on a skill.
      // An empty string records that it was absent rather than inventing one.
      id: typeof s.id === "string" ? s.id : "",
      name: str(s.name),
      description: str(s.description),
      tags: strArray(s.tags),
      examples: strArray(s.examples),
      inputModes: strArray(s.inputModes),
      outputModes: strArray(s.outputModes),
    });
  }
  return out;
}

/**
 * Every interface the card names, across both spec generations.
 *
 * Order is preference order: the v1.0 spec says the first entry of
 * `supportedInterfaces` is preferred, and a v0.3 card's top-level `url` is by
 * definition its preferred one. A URL that is not a URL is dropped rather than
 * carried forward, so tier 3 never dials a string that only looks like one.
 */
export function readInterfaces(value: unknown): InterfaceDeclaration[] {
  if (typeof value !== "object" || value === null) return [];
  const v = value as Record<string, unknown>;
  const out: InterfaceDeclaration[] = [];
  const push = (i: InterfaceDeclaration): void => {
    if (vetUrl(i.url).allowed && !out.some((e) => e.url === i.url)) out.push(i);
  };
  const topUrl = str(v.url);
  if (topUrl !== null) {
    push({
      url: topUrl,
      transport: str(v.preferredTransport),
      protocolVersion: str(v.protocolVersion),
      source: "url",
    });
  }
  const fromArray = (raw: unknown, source: "additionalInterfaces" | "supportedInterfaces"): void => {
    if (!Array.isArray(raw)) return;
    for (const item of raw) {
      if (typeof item !== "object" || item === null) continue;
      const i = item as Record<string, unknown>;
      const u = str(i.url);
      if (u === null) continue;
      push({
        // v1.0 calls it protocolBinding; v0.3's additionalInterfaces calls it transport.
        url: u,
        transport: str(i.protocolBinding) ?? str(i.transport),
        protocolVersion: str(i.protocolVersion) ?? str(v.protocolVersion),
        source,
      });
    }
  };
  fromArray(v.supportedInterfaces, "supportedInterfaces");
  fromArray(v.additionalInterfaces, "additionalInterfaces");
  return out;
}

/** Fields the spec marks REQUIRED. `url` stands for "somewhere to talk", in either spelling. */
const REQUIRED_CARD_FIELDS = [
  "name",
  "description",
  "version",
  "capabilities",
  "defaultInputModes",
  "defaultOutputModes",
  "skills",
  "url",
] as const;

/**
 * Turn a parsed card into a declaration record. Pure, tolerant, and
 * non-judgemental: absent fields are recorded as absent, never defaulted into
 * something that reads as a claim the operator did not make.
 */
export function parseAgentCard(value: unknown): CardDeclaration {
  if (!looksLikeAgentCard(value)) {
    return {
      ok: false,
      name: null,
      description: null,
      version: null,
      protocolVersion: null,
      provider: null,
      documentationUrl: null,
      capabilities: { streaming: null, pushNotifications: null, stateTransitionHistory: null, extensions: 0, raw: null },
      skills: [],
      skillCount: 0,
      interfaces: [],
      securitySchemes: [],
      missingRequired: [...REQUIRED_CARD_FIELDS],
      reason: "the document is not an Agent Card",
    };
  }
  const v = value as Record<string, unknown>;
  const caps = (typeof v.capabilities === "object" && v.capabilities !== null ? v.capabilities : {}) as Record<string, unknown>;
  const provider = (typeof v.provider === "object" && v.provider !== null ? v.provider : {}) as Record<string, unknown>;
  const schemes =
    typeof v.securitySchemes === "object" && v.securitySchemes !== null && !Array.isArray(v.securitySchemes)
      ? Object.keys(v.securitySchemes as Record<string, unknown>)
      : [];
  const interfaces = readInterfaces(v);
  const skills = readSkills(v);
  const missing = REQUIRED_CARD_FIELDS.filter((f) => {
    if (f === "url") return interfaces.length === 0;
    if (f === "skills") return !Array.isArray(v.skills);
    if (f === "capabilities") return typeof v.capabilities !== "object" || v.capabilities === null;
    if (f === "defaultInputModes" || f === "defaultOutputModes") return !Array.isArray(v[f]);
    return str(v[f]) === null;
  });
  return {
    ok: true,
    name: str(v.name),
    description: str(v.description),
    version: str(v.version),
    protocolVersion: str(v.protocolVersion),
    provider: str(provider.organization),
    documentationUrl: str(v.documentationUrl),
    capabilities: {
      streaming: bool(caps.streaming),
      pushNotifications: bool(caps.pushNotifications),
      stateTransitionHistory: bool(caps.stateTransitionHistory),
      extensions: Array.isArray(caps.extensions) ? caps.extensions.length : 0,
      raw: v.capabilities ?? null,
    },
    skills,
    skillCount: skills.length,
    interfaces,
    securitySchemes: schemes,
    missingRequired: [...missing],
    reason: null,
  };
}

/**
 * What one card fetch established.
 *
 * The status alone is not enough and never was. See the header: a 200 from an
 * SPA catch-all carries an HTML page, and a 200 from an API router carries
 * `{"error":true}`. Both were observed on the first three subjects tried.
 */
export function classifyCardResponse(res: HttpOutcome): {
  outcome: MeasurementOutcome;
  reason: string | null;
  card: unknown;
} {
  if (!res.ok) {
    // The server ANSWERED and declined us. Auth-walled agents are a known,
    // rateable state — the same line probe.ts draws at the MCP handshake.
    if (res.status === 401 || res.status === 403) {
      return { outcome: "auth_walled", reason: `the agent declined an anonymous client (HTTP ${res.status})`, card: null };
    }
    // Up, working, telling us we called too often. Never "down".
    if (res.status === 429) return { outcome: "rate_limited", reason: "HTTP 429", card: null };
    if (res.status === 404 || res.status === 410) {
      return { outcome: "absent", reason: `no card at this path (HTTP ${res.status})`, card: null };
    }
    // A 5xx is the subject's server failing, and it tells us NOTHING about
    // whether the subject has a card. Our failure to measure, recorded as such.
    if (res.status !== null && res.status >= 500) {
      return { outcome: "unmeasured", reason: `server error (HTTP ${res.status}) — could not measure`, card: null };
    }
    if (res.status !== null) {
      return { outcome: "not_a_card", reason: `HTTP ${res.status}`, card: null };
    }
    return { outcome: "unmeasured", reason: res.reason, card: null };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(res.body);
  } catch {
    const ctype = res.headers.get("content-type") ?? "no content-type";
    return { outcome: "not_json", reason: `HTTP 200 but the body is not JSON (${ctype})`, card: null };
  }
  if (!looksLikeAgentCard(parsed)) {
    return { outcome: "not_a_card", reason: "HTTP 200 with JSON that is not an Agent Card", card: parsed };
  }
  return { outcome: "card", reason: null, card: parsed };
}

/**
 * Which JSON-RPC method names this card's generation uses.
 *
 * v0.3 (everything observed in the wild so far) sends `tasks/get`. The v1.0
 * spec's method mapping table renamed it to `GetTask`. Both are tried — primary
 * first — because -32601 from the wrong spelling is indistinguishable from an
 * unimplemented method unless you ask the other way too.
 */
export function livenessMethods(protocolVersion: string | null): { primary: string; alternate: string } {
  const major = Number(/^(\d+)/.exec(protocolVersion ?? "")?.[1] ?? "0");
  return major >= 1 ? { primary: "GetTask", alternate: "tasks/get" } : { primary: "tasks/get", alternate: "GetTask" };
}

type RpcEnvelope = { jsonrpc?: unknown; id?: unknown; result?: unknown; error?: { code?: unknown; message?: unknown } };

/** JSON-RPC's "method not found". A healthy agent returns this for the wrong spec generation's spelling. */
export const METHOD_NOT_FOUND = -32601;

/**
 * What the endpoint's answer to the benign call proves.
 *
 * The distinction that earns its keep: a JSON-RPC error is a SUCCESSFUL
 * measurement. `-32001 Task not found` is the correct answer to asking for a
 * task that does not exist, and it is the strongest evidence available short of
 * invoking something — it proves the endpoint parses A2A, routes A2A methods,
 * and is running. Both live agents in the first sample answered exactly that.
 */
export function classifyRpcResponse(res: HttpOutcome, method: string): {
  verdict: ReachabilityVerdict;
  rpcErrorCode: number | null;
  rpcErrorMessage: string | null;
  reason: string | null;
} {
  if (!res.ok) {
    if (res.status === 401 || res.status === 403) {
      return { verdict: "auth_walled", rpcErrorCode: null, rpcErrorMessage: null, reason: `the endpoint declined an anonymous client (HTTP ${res.status})` };
    }
    if (res.status === 429) {
      return { verdict: "rate_limited", rpcErrorCode: null, rpcErrorMessage: null, reason: "HTTP 429" };
    }
    if (res.status !== null && res.status >= 500) {
      return { verdict: "unmeasured", rpcErrorCode: null, rpcErrorMessage: null, reason: `server error (HTTP ${res.status}) — could not measure` };
    }
    if (res.status !== null) {
      // A 404 or 405 at the URL the card itself named is a finding about the
      // card, not a failure of ours: the agent answered, from the address it
      // published, that there is nothing there.
      return { verdict: "answered_not_a2a", rpcErrorCode: null, rpcErrorMessage: null, reason: `HTTP ${res.status} at the declared endpoint` };
    }
    return { verdict: "unmeasured", rpcErrorCode: null, rpcErrorMessage: null, reason: res.reason };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(res.body);
  } catch {
    return { verdict: "answered_not_a2a", rpcErrorCode: null, rpcErrorMessage: null, reason: "HTTP 200 with a body that is not JSON" };
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return { verdict: "answered_not_a2a", rpcErrorCode: null, rpcErrorMessage: null, reason: "the reply is not a JSON-RPC object" };
  }
  const env = parsed as RpcEnvelope;
  const hasEnvelope = "result" in env || "error" in env || env.jsonrpc === "2.0";
  if (!hasEnvelope) {
    return { verdict: "answered_not_a2a", rpcErrorCode: null, rpcErrorMessage: null, reason: "JSON with no JSON-RPC result or error" };
  }
  const code = typeof env.error?.code === "number" ? env.error.code : null;
  const message = typeof env.error?.message === "string" ? env.error.message.slice(0, 200) : null;
  if (code === METHOD_NOT_FOUND) {
    return { verdict: "jsonrpc_no_a2a_method", rpcErrorCode: code, rpcErrorMessage: message, reason: `${method} is not implemented (-32601)` };
  }
  return { verdict: "speaks_a2a", rpcErrorCode: code, rpcErrorMessage: message, reason: null };
}

/**
 * One outcome for the whole of tier 1, from every path tried.
 *
 * The ordering rule, and why it exists: an answer from a path WE invented never
 * outranks an answer from the spec's path or from the operator's own. The
 * termix.live batch is the case in point — 404 from both well-known paths and
 * 401 from the path this prober guessed. Reporting that subject as auth-walled
 * would be reporting our guess as their state.
 *
 * A measurement gap is only the summary when nothing better was learned: if any
 * authoritative path produced a fact, that fact is the finding, and the gap on
 * another path stays visible in `attempts`.
 */
export function summarizeDiscovery(
  attempts: CardAttempt[],
  chosen: CardAttempt | null,
): { outcome: MeasurementOutcome; reason: string | null } {
  if (chosen?.outcome === "card") return { outcome: "card", reason: null };
  const authoritative = attempts.filter((a) => a.kind !== "guess" && isSubjectFact(a.outcome));
  const anyFact = attempts.filter((a) => isSubjectFact(a.outcome));
  const pick = authoritative[0] ?? anyFact[0] ?? null;
  if (pick !== null) return { outcome: pick.outcome, reason: pick.reason };
  const gap = attempts[0] ?? null;
  return { outcome: gap?.outcome ?? "unmeasured", reason: gap?.reason ?? "no card at any candidate path" };
}

function gapFor(tier: AssessmentGap["tier"], outcome: MeasurementOutcome | ReachabilityVerdict, reason: string | null): AssessmentGap | null {
  if (outcome !== "unmeasured" && outcome !== "refused") return null;
  return { tier, reason: reason ?? "unmeasured" };
}

/**
 * Probe one A2A agent: find the card, read what it declares, check the declared
 * endpoint is there.
 *
 * Each tier degrades into the next rather than aborting the run. No card still
 * produces a transcript, with every path tried and why each failed, because
 * "we could not find a card" is itself the measurement — and the difference
 * between that and "this agent publishes no card" lives in `gaps`.
 */
export async function probeA2aAgent(baseUrl: string, opts: A2aProbeOptions = {}): Promise<A2aTranscript> {
  const nowIso = opts.nowIso ?? isoNow;
  const probedAt = nowIso();
  const timeoutMs = opts.timeoutMs ?? 10_000;
  const gaps: AssessmentGap[] = [];
  const base: GuardedFetchOptions = {
    timeoutMs,
    ...(opts.fetchImpl === undefined ? {} : { fetchImpl: opts.fetchImpl }),
  };
  const userAgent = opts.identity?.userAgent ?? USER_AGENT;

  // ---- Tier 1: discovery -------------------------------------------------
  const started = Date.now();
  const candidates = cardCandidates(baseUrl);
  const attempts: CardAttempt[] = [];
  let discovery: CardDiscovery;
  let card: unknown = null;

  if (candidates.length === 0) {
    // Our guard declined it. That is a fact about our policy, not about the
    // agent, so it is a gap and not an absence.
    const vetted = vetUrl(baseUrl);
    const reason = vetted.allowed ? "no candidate card URL" : `refused: ${vetted.reason}`;
    discovery = { ok: false, url: null, path: null, outcome: "refused", attempts: [], reason, elapsedMs: 0 };
  } else {
    let chosen: CardAttempt | null = null;
    for (const c of candidates) {
      const res = await guardedFetch(c.url, {
        ...base,
        method: "GET",
        headers: { accept: "application/json", "user-agent": userAgent },
      });
      const verdict = classifyCardResponse(res);
      const attempt: CardAttempt = {
        url: c.url,
        path: c.path,
        kind: c.kind,
        outcome: verdict.outcome,
        status: res.status,
        contentType: res.headers?.get("content-type") ?? null,
        reason: verdict.reason,
        elapsedMs: res.elapsedMs,
      };
      attempts.push(attempt);
      if (verdict.outcome === "card") {
        card = verdict.card;
        chosen = attempt;
        break;
      }
      // An auth wall is a terminal ANSWER, not a reason to keep knocking on
      // other paths of a host that has already told us to go away.
      if (verdict.outcome === "auth_walled" || verdict.outcome === "rate_limited") {
        chosen = attempt;
        break;
      }
    }
    const summary = summarizeDiscovery(attempts, chosen);
    discovery = {
      ok: summary.outcome === "card",
      url: summary.outcome === "card" ? (chosen?.url ?? null) : null,
      path: summary.outcome === "card" ? (chosen?.path ?? null) : null,
      outcome: summary.outcome,
      attempts,
      reason: summary.reason,
      elapsedMs: Date.now() - started,
    };
  }
  const discoveryGap = gapFor("discovery", discovery.outcome, discovery.reason);
  if (discoveryGap !== null) gaps.push(discoveryGap);

  // ---- Tier 2: declaration ----------------------------------------------
  const declaration: CardDeclaration | null = discovery.ok ? parseAgentCard(card) : null;

  // ---- Tier 3: reachability ---------------------------------------------
  let reachability: EndpointReachability | null = null;
  if (opts.reachability !== false && declaration !== null) {
    const target = declaration.interfaces[0] ?? null;
    if (target === null) {
      reachability = {
        ok: false,
        url: null,
        verdict: "not_declared",
        status: null,
        method: null,
        rpcErrorCode: null,
        rpcErrorMessage: null,
        reason: "the card declares no interface URL",
        elapsedMs: 0,
      };
    } else {
      // SUBJECT-CHOSEN URL. Re-vetted here so the refusal is legible in the
      // transcript, and re-vetted again by guardedFetch on every hop.
      const vetted = vetUrl(target.url);
      if (!vetted.allowed) {
        reachability = {
          ok: false,
          url: target.url,
          verdict: "refused",
          status: null,
          method: null,
          rpcErrorCode: null,
          rpcErrorMessage: null,
          reason: `refused: ${vetted.reason}`,
          elapsedMs: 0,
        };
      } else {
        reachability = await checkReachable(target.url, declaration.protocolVersion, { base, userAgent, opts });
      }
    }
    const reachGap = gapFor("reachability", reachability.verdict, reachability.reason);
    if (reachGap !== null) gaps.push(reachGap);
  }

  return {
    transcript_version: "1",
    probe_id: A2A_PROBE_ID,
    subject_url: baseUrl,
    probed_at: probedAt,
    discovery,
    declaration,
    reachability,
    registry: opts.registry ?? null,
    gaps,
  };
}

/**
 * One benign JSON-RPC call, retried once with the other generation's method
 * name. Reads a task that cannot exist; mutates nothing.
 */
async function checkReachable(
  url: string,
  protocolVersion: string | null,
  ctx: { base: GuardedFetchOptions; userAgent: string; opts: A2aProbeOptions },
): Promise<EndpointReachability> {
  const { primary, alternate } = livenessMethods(protocolVersion);
  const id = ctx.opts.requestId ?? 1;
  const taskId = ctx.opts.probeTaskId ?? "00000000-0000-4000-8000-000000000000";
  const started = Date.now();
  let last: { res: HttpOutcome; method: string; verdict: ReturnType<typeof classifyRpcResponse> } | null = null;

  for (const method of [primary, alternate]) {
    const res = await guardedFetch(url, {
      ...ctx.base,
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        "user-agent": ctx.userAgent,
      },
      body: JSON.stringify({ jsonrpc: "2.0", id, method, params: { id: taskId } }),
    });
    const verdict = classifyRpcResponse(res, method);
    last = { res, method, verdict };
    // Only -32601 justifies a second request. Anything else is an answer.
    if (verdict.verdict !== "jsonrpc_no_a2a_method") break;
  }

  if (last === null) {
    return {
      ok: false,
      url,
      verdict: "unmeasured",
      status: null,
      method: null,
      rpcErrorCode: null,
      rpcErrorMessage: null,
      reason: "no request was made",
      elapsedMs: Date.now() - started,
    };
  }
  const v = last.verdict.verdict;
  return {
    // `ok` is "the endpoint answered us", which an auth wall and a rate limit
    // both did. It is not "we got what we wanted".
    ok: v === "speaks_a2a" || v === "jsonrpc_no_a2a_method" || v === "auth_walled" || v === "rate_limited",
    url,
    verdict: v,
    status: last.res.status,
    method: last.method,
    rpcErrorCode: last.verdict.rpcErrorCode,
    rpcErrorMessage: last.verdict.rpcErrorMessage,
    reason: last.verdict.reason,
    elapsedMs: Date.now() - started,
  };
}
