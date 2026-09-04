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
};
