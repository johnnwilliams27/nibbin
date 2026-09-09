/**
 * What an MCP probe run records.
 *
 * Kept as plain data, separate from both the code that produces it and the
 * code that judges it, for three reasons. A transcript can be stored and
 * re-judged when a rubric changes, without re-probing someone's server. The
 * judging can be tested exhaustively without a network. And a published score
 * can cite the transcript that produced it, which is the difference between a
 * rating and an assertion.
 */

/** One tool as the server declares it. */
export type ToolDeclaration = {
  name: string;
  description: string | null;
  /** The declared JSON Schema, unvalidated and unmodified. */
  inputSchema: unknown;
  /**
   * The declared output schema, when the server publishes one. A tool that
   * violates its own declared output shape is broken in a way a caller hits
   * immediately, and that is only checkable if we record the declaration.
   */
  outputSchema: unknown;
  /**
   * MCP tool annotations, verbatim: readOnlyHint, destructiveHint,
   * idempotentHint, openWorldHint.
   *
   * The spec is right that a client must not TRUST these for security, and we
   * do not. They earn their place two other ways. As a gate: we only exercise
   * a tool the operator has affirmatively declared read-only, with nothing
   * else contradicting it. And as evidence in their own right: a tool named
   * delete_document carrying readOnlyHint true is a contradiction, and that is
   * a stronger finding than any name heuristic, obtained without sending
   * anything.
   *
   * Not reading these at all was a real gap in the first version of this
   * collector, which parsed tool names while ignoring the field the protocol
   * provides for exactly this question.
   */
  annotations: unknown;
};

/** One attempt to reach the endpoint. */
export type ProbeAttempt = {
  attempt: number;
  /** ISO-8601 UTC, second precision, from the collector's clock at probe time. */
  ts: string;
  reachable: boolean;
  status: number | null;
  /** Failure reason, verbatim, or null when the attempt succeeded. */
  reason: string | null;
  elapsedMs: number;
};

export type HandshakeResult = {
  ok: boolean;
  protocolVersion: string | null;
  serverName: string | null;
  serverVersion: string | null;
  /** The server's own instructions text, if it sent any. Its presence is measured; its content is the server's claim. */
  instructions: string | null;
  reason: string | null;
};

export type ToolsResult = {
  ok: boolean;
  declared: ToolDeclaration[];
  reason: string | null;
};

/**
 * What the registry says about the server, as distinct from what the server
 * says about itself when probed. Publisher-supplied, so anything scored from
 * it is self-reported and capped accordingly.
 */
export type RegistryFacts = {
  /** Registry's canonical name for the server. */
  name: string;
  description: string | null;
  version: string | null;
  /** ISO-8601 UTC of the most recent publish, when the registry reports one. */
  published_at: string | null;
  /** ISO-8601 UTC of the first publish, when the registry reports one. */
  first_published_at: string | null;
  /** Where the source lives, when declared. */
  repository_url: string | null;
  /** Published versions of this server seen in the registry. null when not counted. */
  /**
   * Versions the registry lists for this server.
   *
   * Optional because transcripts persisted before this field existed do not
   * carry it, and pretending otherwise is what broke every end-to-end score:
   * the declaration said `number | null`, the stored data had neither, and the
   * absent case was never handled. Readers must check for a number rather than
   * test against null.
   */
  version_count?: number | null;
};

/**
 * The endpoint answered but refused an anonymous client.
 *
 * HTTP 401 was 48% of the first 200-server sample. Those servers are up,
 * working, and correctly declining a client with no account. Recording that as
 * unavailability would rate half the population as down when the missing thing
 * is ours, which is the exact failure AssessmentGap exists to prevent. It is
 * recorded here as its own fact so the rubric can emit a harness gap rather
 * than an observation.
 */
export type AuthResult = {
  /**
   * THE HANDSHAKE required authentication. Not the tools.
   *
   * Read this field for what it measures and nothing else. It is set from the
   * `initialize` hop, and `initialize` is genuinely open on most MCP servers —
   * so `required: false` means "we got a handshake", never "this server needs
   * no credential". Six servers worked by hand in the auth triage
   * (lumify, chronary, creativescope, klarix, framethrower, drillr) each record
   * `required: false` here and wall every single `tools/call`. The wall moved
   * one hop downstream and the field did not follow it.
   *
   * `tool_auth` on the transcript is the field that answers the tool question,
   * and its absence means UNMEASURED rather than open.
   */
  required: boolean;
  status: number | null;
  /** WWW-Authenticate or equivalent, when the server says how to authenticate. */
  scheme: string | null;
  /**
   * Which hop established this. Always `initialize` — named in the data rather
   * than only in this comment, so a reader of a stored transcript can see the
   * scope of the claim without reading the prober.
   *
   * Optional: transcripts persisted before this field existed do not carry it,
   * and they were all `initialize` too.
   */
  hop?: "initialize";
};

/**
 * Whether `tools/call` is walled — decided on the BODY, not the status.
 *
 * The separate field exists because the two walls are separate facts and were
 * being reported as one. A server can be open at `initialize` and closed at
 * every tool; that is the common case, not the exotic one. And the wall
 * frequently arrives as a JSON-RPC error inside an HTTP 200 (lumify:
 * `-32001 Unauthorized: provide a valid Lumify API key as a Bearer token`,
 * served with a 200), so a classifier watching HTTP status alone sees an open
 * server answering cheerfully.
 *
 * Derived by `classifyToolAuth`, which delegates every per-call judgement to
 * `diagnoseInvocation` rather than inventing a second vocabulary for the same
 * distinction. A rate limit is not a wall: an allowance we spent clears by
 * waiting, and conflating the two is how echoloc got recorded as needing an
 * account it did not need.
 *
 * ABSENT MEANS UNMEASURED. Never read a missing `tool_auth` as an open tool
 * surface; that is the exact substitution this type exists to prevent.
 */
export type ToolAuthResult = {
  walled: boolean;
  /** Counts by `diagnoseInvocation` verdict across every call considered. The audit trail for `walled`. */
  verdicts: Record<string, number>;
  /** How many calls were considered. Zero is impossible: with no calls there is no ToolAuthResult. */
  calls: number;
  /** The tool whose refusal is quoted in `evidence`. */
  tool: string | null;
  /** Verbatim, so a reader never has to take the classification on trust. */
  evidence: string | null;
  /**
   * Where the refusal appeared. `http_status` for a 401/403, `in_band` for a
   * JSON-RPC error or an `isError` payload inside a 2xx. Recorded because the
   * in-band form is the one that fooled the old classifier, and counting it is
   * the only way to know how much of the population it hides.
   */
  signal: "http_status" | "in_band" | null;
  /** ISO-8601 UTC of the calls this was derived from. */
  measured_at: string;
};

/**
 * The endpoint answered HTTP 429: up, working, and telling us we called too
 * often.
 *
 * Its own field, and not folded into `attempts[].reachable`, because a 429 was
 * being recorded as `reachable: false` — an availability observation of ZERO
 * against a server that had just answered us. That is the project's defining
 * error in its usual disguise: we could not obtain the data, therefore the data
 * is not there. `diagnoseInvocation` already separates `rate_limited` from
 * `subject_failed` at the tool-call layer; this is the same distinction one
 * layer up, where nothing had been drawing it.
 *
 * Optional because transcripts persisted before this field existed do not carry
 * it. Read it with a `=== true` test, never against null — the version_count
 * field learned that lesson the expensive way.
 */
export type RateLimitResult = {
  limited: boolean;
  status: number | null;
};

export type ProbeTranscript = {
  transcript_version: "1";
  /** Stable id of the probe harness. Becomes the observer_id, so a rubric change that needs a new observer changes this. */
  probe_id: string;
  /** The remote endpoint probed. */
  endpoint: string;
  /** ISO-8601 UTC of the run. */
  probed_at: string;
  attempts: ProbeAttempt[];
  /** null when no attempt got far enough to try a handshake. */
  handshake: HandshakeResult | null;
  /** null when the handshake never succeeded. */
  tools: ToolsResult | null;
  registry: RegistryFacts | null;
  /** Handshake auth only. null when no attempt reached a status that could establish it. See AuthResult. */
  auth: AuthResult | null;
  /**
   * Tool-surface auth, from `tools/call`. Absent or null means UNMEASURED —
   * the probe does not call tools, so only a run that did can fill this.
   */
  tool_auth?: ToolAuthResult | null;
  /** Present, and `limited: true`, when the endpoint rate-limited us. See RateLimitResult. */
  rate_limit?: RateLimitResult | null;
};
