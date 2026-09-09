/**
 * What an A2A probe run records.
 *
 * Same split as the MCP transcript, for the same three reasons: a transcript
 * can be re-judged when a rubric changes without re-probing someone's agent,
 * the judging can be tested without a network, and a published score can cite
 * the transcript that produced it.
 *
 * The type that matters most here is `MeasurementOutcome`. A2A discovery is a
 * fetch of a static JSON document, which makes it very easy to write down "no
 * card" when what actually happened was "we did not get one". Those are
 * different findings and this file keeps them in different values.
 */

/**
 * What one HTTP exchange with the subject established.
 *
 * Split down the middle, and the middle is the only line that matters:
 *
 *   FACTS ABOUT THE SUBJECT — the server answered, and the answer is evidence.
 *     card          a parseable Agent Card came back
 *     not_json      200, but the body is not JSON (an SPA catch-all, usually)
 *     not_a_card    JSON, but not an Agent Card
 *     auth_walled   401/403: it answered and declined us. Known, rateable.
 *     rate_limited  429: up, working, telling us we called too often.
 *     absent        404/410: this path serves no card, and the server said so.
 *
 *   FACTS ABOUT OUR MEASUREMENT — we learned nothing about the subject.
 *     unmeasured    timeout, DNS failure, transport error, 5xx
 *     refused       our own guard declined to dial it
 *
 * A 5xx sits in the second group deliberately. It is the subject's server
 * failing, but what it tells us about the subject's A2A support is nothing, and
 * a collector that scored it as "no card" would be recording our inability to
 * measure as a property of the thing measured. That substitution is the oldest
 * bug in this project and it gets a type, not a comment.
 */
export type MeasurementOutcome =
  | "card"
  | "not_json"
  | "not_a_card"
  | "auth_walled"
  | "rate_limited"
  | "absent"
  | "unmeasured"
  | "refused";

/** True when the outcome says something about the subject rather than about us. */
export function isSubjectFact(outcome: MeasurementOutcome): boolean {
  return outcome !== "unmeasured" && outcome !== "refused";
}

/** One card path tried, and what came back. Every path tried is recorded, including the ones that failed. */
export type CardAttempt = {
  url: string;
  /** The path component, so a sweep can count which spelling the population actually serves. */
  path: string;
  outcome: MeasurementOutcome;
  status: number | null;
  contentType: string | null;
  /** Never null except on `card`: every failure records why. */
  reason: string | null;
  elapsedMs: number;
};

/** Tier 1: did we get an Agent Card, and from where. */
export type CardDiscovery = {
  ok: boolean;
  /** The URL that produced the card. Null when none did. */
  url: string | null;
  /** Which path worked — `/.well-known/agent-card.json`, the legacy `agent.json`, or a registry-declared URL. */
  path: string | null;
  outcome: MeasurementOutcome;
  attempts: CardAttempt[];
  reason: string | null;
  elapsedMs: number;
};

/** One skill as the agent declares it. Verbatim; nothing here is verified. */
export type SkillDeclaration = {
  id: string;
  name: string | null;
  description: string | null;
  tags: string[];
  /** Example prompts the operator published. Their presence is measured; their content is a claim. */
  examples: string[];
  inputModes: string[];
  outputModes: string[];
};

/**
 * A place the agent says it can be spoken to.
 *
 * Normalized across two spec generations, because the population straddles
 * them. v0.3 cards carry a top-level `url` plus `preferredTransport` and an
 * optional `additionalInterfaces[]`; the v1.0 spec replaced all three with
 * `supportedInterfaces[]` (AgentInterface: `url`, `protocolBinding`,
 * `protocolVersion`), first entry preferred. Reading only one shape would make
 * the other generation look like an agent with nowhere to talk.
 */
export type InterfaceDeclaration = {
  url: string;
  /** `preferredTransport` (v0.3) or `protocolBinding` (v1.0). Null when unstated. */
  transport: string | null;
  protocolVersion: string | null;
  source: "url" | "additionalInterfaces" | "supportedInterfaces";
};

/** Tier 2: what the card claims. Self-reported, in full. */
export type CardDeclaration = {
  ok: boolean;
  name: string | null;
  description: string | null;
  version: string | null;
  /** The A2A protocol version the card declares — "0.3.0" on everything sampled so far. */
  protocolVersion: string | null;
  provider: string | null;
  documentationUrl: string | null;
  /** AgentCapabilities, read for the flags the spec names and kept verbatim beside them. */
  capabilities: {
    streaming: boolean | null;
    pushNotifications: boolean | null;
    stateTransitionHistory: boolean | null;
    /** Count of declared protocol extensions. */
    extensions: number;
    raw: unknown;
  };
  skills: SkillDeclaration[];
  skillCount: number;
  interfaces: InterfaceDeclaration[];
  /** Names of the declared security schemes. Empty means the card declares none, which is not the same as none being required. */
  securitySchemes: string[];
  /**
   * Fields the spec marks REQUIRED that this card does not carry.
   *
   * A conformance finding, and one obtainable without sending the agent
   * anything. Recorded rather than judged: the rubric decides what a missing
   * `description` is worth.
   */
  missingRequired: string[];
  reason: string | null;
};

/** What the endpoint's answer to a benign call proves. */
export type ReachabilityVerdict =
  /** A JSON-RPC envelope came back to an A2A method. It is up and it speaks A2A. */
  | "speaks_a2a"
  /** JSON-RPC, but the A2A method is not implemented (-32601 to both spellings). Up; conformance is another matter. */
  | "jsonrpc_no_a2a_method"
  /** The server answered and it was not A2A: a 404 at the declared URL, an HTML page, a non-JSON body. */
  | "answered_not_a2a"
  /** 401/403. It answered and declined us. Known, rateable, NOT down. */
  | "auth_walled"
  /** 429. Alive, and rate-limiting us. */
  | "rate_limited"
  /** We failed to measure: timeout, DNS, transport, 5xx. Says nothing about the subject. */
  | "unmeasured"
  /** Our guard declined to dial the subject-chosen URL. */
  | "refused"
  /** The card named no interface to dial. A declaration finding, not a reachability one. */
  | "not_declared";

/** Tier 3: is the declared endpoint actually there. No skill is ever invoked. */
export type EndpointReachability = {
  ok: boolean;
  url: string | null;
  verdict: ReachabilityVerdict;
  status: number | null;
  /** The JSON-RPC method used, so a reader knows which spec generation the answer is against. */
  method: string | null;
  rpcErrorCode: number | null;
  /** Verbatim, so a classification never has to be taken on trust. */
  rpcErrorMessage: string | null;
  reason: string | null;
  elapsedMs: number;
};

/**
 * Something we could not measure, and why.
 *
 * Its own list so a consumer cannot miss it. A transcript with an empty
 * `declaration` and an empty `gaps` means the card was read and declared
 * nothing; a transcript with an empty `declaration` and a gap means we never
 * saw the card. Those must never collapse into one score.
 */
export type AssessmentGap = {
  tier: "discovery" | "declaration" | "reachability";
  reason: string;
};

/** What a registry claimed, as distinct from what the agent says when asked. */
export type A2aRegistryFacts = {
  name: string | null;
  description: string | null;
  /** The A2A endpoint the registry advertises. Frequently NOT where the card lives — see probe.ts. */
  declared_endpoint: string | null;
  declared_version: string | null;
  /** Chain coordinates, when the registry is a chain index. */
  chain_id?: number | null;
  token_id?: string | null;
};

export type A2aTranscript = {
  transcript_version: "1";
  probe_id: string;
  /** What we were asked to probe, verbatim. */
  subject_url: string;
  /** ISO-8601 UTC of the run. */
  probed_at: string;
  discovery: CardDiscovery;
  /** null when no card was obtained. Never means "the card declared nothing". */
  declaration: CardDeclaration | null;
  /** null when tier 3 was not run. */
  reachability: EndpointReachability | null;
  registry: A2aRegistryFacts | null;
  gaps: AssessmentGap[];
};
