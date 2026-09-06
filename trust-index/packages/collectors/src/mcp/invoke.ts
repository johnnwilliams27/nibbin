/**
 * Calling a tool.
 *
 * Everything before this file reads declarations. This is the first code that
 * exercises somebody else's software, and the whole product turns on it: a
 * rating derived from a manifest rates the manifest, and a server declaring
 * five beautifully documented tools that all return HTTP 500 scores well until
 * something calls them.
 *
 * THE GUARD IS RE-CHECKED HERE, not inherited. classifyTool decides what is
 * callable; callTool refuses anything that is not `read_only` at the moment of
 * the call, so a future caller cannot pass a classification it computed
 * differently, or an unclassified tool, or a tool whose classification was
 * cached before a rubric change. A safety rule enforced only at the point of
 * decision and not at the point of action is one refactor away from being
 * enforced nowhere.
 *
 * What we send: arguments synthesized from the tool's own declared schema,
 * required fields only, benign values, and never anything shaped like a
 * credential. Required fields only is deliberate. Optional parameters are
 * where the sharp edges live, and the smallest valid call is the one whose
 * behaviour the declaration most clearly predicts.
 *
 * What we learn, none of which is in the manifest: whether it answers at all,
 * whether it honours its own declared output schema, how long it takes, how
 * much of the caller's context window the response burns, and whether it
 * returns a protocol-level error or a cheerful success containing an error
 * message.
 */
import { createHash } from "node:crypto";
import { guardedFetch } from "../net.js";
import { requestId } from "./probe-identity.js";
import type { ToolClassification } from "./shape.js";
import type { ToolDeclaration } from "./transcript.js";

const PROTOCOL_VERSION = "2025-06-18";
/**
 * Fallback identity, used only when the caller passes none.
 *
 * The old value was `trust-index-probe/0.1` plus this repository's URL, which
 * announced to every server exactly which source file held the constants it was
 * about to be tested with. Callers should pass a per-subject identity from
 * probe-identity.ts; this generic string is the floor, not the intent.
 */
const USER_AGENT = "mcp-client/1.0.0";

/**
 * Benign values by parameter name. Chosen to be plausible enough that a
 * working tool actually does something (a search for "weather" hits most
 * corpora; a search for "zzz" hits none, and we would learn nothing about a
 * tool that correctly returned zero results).
 *
 * Nothing here is or resembles a credential. A tool asking for one is already
 * a finding, and feeding it a fake secret would teach us nothing while
 * training operators that credentials arrive from strangers.
 */
const VALUE_BY_NAME: ReadonlyArray<{ match: readonly string[]; value: unknown }> = [
  { match: ["query", "q", "search", "search_query", "term", "keyword", "keywords", "text", "prompt", "question"], value: "weather" },
  { match: ["city", "location", "place", "address", "region"], value: "London" },
  { match: ["country", "country_code"], value: "US" },
  { match: ["lang", "language", "locale"], value: "en" },
  { match: ["url", "uri", "link", "website"], value: "https://example.com" },
  { match: ["date", "start_date", "from_date", "day"], value: "2026-09-01" },
  { match: ["end_date", "to_date"], value: "2026-09-02" },
  { match: ["limit", "count", "max_results", "top_k", "n", "size", "per_page"], value: 1 },
  { match: ["page", "offset", "skip"], value: 0 },
  { match: ["symbol", "ticker"], value: "AAPL" },
  { match: ["currency", "from_currency", "base"], value: "USD" },
  { match: ["to_currency", "quote", "target"], value: "EUR" },
  { match: ["amount", "value", "quantity"], value: 1 },
  { match: ["id", "identifier", "slug", "name", "key"], value: "test" },
  { match: ["format", "output_format"], value: "json" },
];

/** Parameter names we refuse to fill, because filling them teaches nobody anything good. */
const NEVER_FILL = [
  "apikey", "api_key", "token", "access_token", "secret", "password", "passwd",
  "private_key", "privatekey", "credential", "credentials", "session_key", "authorization",
];

function normalize(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, "_");
}

export type SynthesizedInput = {
  args: Record<string, unknown>;
  /** Parameters we declined to fill, and why. Part of the audit trail for what we sent. */
  skipped: Array<{ parameter: string; reason: string }>;
};

function valueForProperty(name: string, spec: Record<string, unknown>): unknown {
  // A declared enum settles it: the first permitted value is valid by
  // construction, which beats any guess of ours.
  if (Array.isArray(spec.enum) && spec.enum.length > 0) return spec.enum[0];
  if (spec.default !== undefined) return spec.default;

  const n = normalize(name);
  const type = typeof spec.type === "string" ? spec.type : Array.isArray(spec.type) ? String(spec.type[0]) : "string";

  const named = VALUE_BY_NAME.find((v) => v.match.includes(n));
  if (named !== undefined) {
    // Respect the declared type over the name hint: a parameter called `limit`
    // declared as a string should get "1", not 1.
    if (type === "string" && typeof named.value === "number") return String(named.value);
    if ((type === "number" || type === "integer") && typeof named.value === "string") return 1;
    return named.value;
  }

  switch (type) {
    case "number":
    case "integer": {
      const min = typeof spec.minimum === "number" ? spec.minimum : 1;
      const max = typeof spec.maximum === "number" ? spec.maximum : min;
      return Math.min(Math.max(1, min), Math.max(min, max));
    }
    case "boolean":
      return false;
    case "array":
      return [];
    case "object":
      return {};
    default:
      return "test";
  }
}

/**
 * Build the smallest valid call from a tool's own declared schema.
 *
 * Required fields only. Optional parameters are where the sharp edges live,
 * and the minimal call is the one whose behaviour the declaration most clearly
 * predicts, which is what makes a mismatch meaningful.
 */
export function synthesizeInput(schema: unknown): SynthesizedInput {
  const args: Record<string, unknown> = {};
  const skipped: Array<{ parameter: string; reason: string }> = [];
  if (typeof schema !== "object" || schema === null) return { args, skipped };
  const s = schema as Record<string, unknown>;
  const props = typeof s.properties === "object" && s.properties !== null ? (s.properties as Record<string, unknown>) : {};
  const required = Array.isArray(s.required) ? s.required.filter((r): r is string => typeof r === "string") : [];

  for (const name of required) {
    const n = normalize(name);
    if (NEVER_FILL.some((c) => n === c || n === c.replace(/_/g, ""))) {
      skipped.push({ parameter: name, reason: "asks for a credential" });
      continue;
    }
    const spec = props[name];
    args[name] = valueForProperty(name, typeof spec === "object" && spec !== null ? (spec as Record<string, unknown>) : {});
  }
  return { args, skipped };
}

export type ToolCallResult = {
  tool: string;
  shape: string;
  basis: string;
  args: Record<string, unknown>;
  /** The call completed at the transport level. */
  ok: boolean;
  /** The tool reported a failure in its own result envelope. Distinct from a transport failure. */
  isError: boolean | null;
  reason: string | null;
  elapsedMs: number;
  /** Bytes of response. A real cost signal: this comes out of the caller's context window. */
  responseBytes: number;
  /** Content block types the tool returned. */
  contentTypes: string[];
  /** The tool returned structuredContent alongside its text. */
  structuredContent: boolean;
  /** Declared an outputSchema, and the response's structuredContent has its required keys. null when no schema was declared. */
  matchesOutputSchema: boolean | null;
  /** First slice of the text response, kept so the mapping can be read by a human. */
  textSample: string | null;
  /**
   * The whole text response, capped only where it stops being storable.
   *
   * Added after `textSample` turned out to be the single largest source of
   * measured error in the judge experiment. Storing 300 characters and passing
   * them on as if they were a response meant a judge was shown JSON cut off
   * mid-structure, WITH NO INDICATION IT HAD BEEN CUT, and called it a failure
   * — which is the correct reading of a malformed fragment. Error rate on
   * truncated items was 45% against 13% on whole ones.
   *
   * The cap here is 32 KB rather than 300 bytes: large enough that a cut is
   * rare, small enough that one pathological 111 KB response cannot dominate a
   * transcript file. When it does cut, the marker says so, because a fragment
   * a reader knows is a fragment is a different question from a fragment that
   * looks like corruption.
   */
  text: string | null;
  /** True when `text` hit the cap. Reported so a downstream reader never has to guess. */
  textTruncated: boolean;
  /**
   * Fingerprint of the WHOLE text response, for comparing two calls.
   *
   * Comparing textSample instead was a real defect: two responses identical in
   * their first 300 characters and different thereafter were reported as the
   * tool ignoring its input.
   */
  textFingerprint: string | null;
  /**
   * The response is a successful, substantive answer rather than an error, an
   * empty result, or an error payload wearing a success envelope.
   *
   * Every comparison check depends on this. Two identical errors say nothing
   * about whether a tool reads its input, and a first run reported six tools as
   * input-blind when every one of them had returned the same error or the same
   * honest empty result to both queries.
   */
  substantive: boolean;
  /** The payload reads as an error while the protocol envelope says success. A conformance finding in itself. */
  errorInPayload: boolean;
  /** The tool declined rather than answered. Correct behaviour, and not an answer. */
  refused: boolean;
};

export class NotCallableError extends Error {}

/**
 * Refuse anything not classified read-only, at the moment of the call.
 *
 * Deliberately a throw rather than a returned failure. A tool we must not call
 * is a programming error at the call site, not a measurement outcome, and
 * swallowing it into a result row is how it ends up looking like an ordinary
 * failing tool in a report.
 */
export function assertCallable(c: ToolClassification): void {
  if (c.binding.kind !== "read_only") {
    throw new NotCallableError(
      `refusing to call ${c.tool}: classified ${c.binding.kind}, only read_only tools may be invoked`,
    );
  }
  if (c.contradictions.length > 0) {
    throw new NotCallableError(`refusing to call ${c.tool}: ${c.contradictions.length} declaration contradictions`);
  }
}

function requiredKeys(schema: unknown): string[] {
  if (typeof schema !== "object" || schema === null) return [];
  const s = schema as Record<string, unknown>;
  return Array.isArray(s.required) ? s.required.filter((r): r is string => typeof r === "string") : [];
}

export type CallOptions = {
  sessionId?: string | null;
  timeoutMs?: number;
  maxBytes?: number;
  fetchImpl?: typeof fetch;
  /** Parse a JSON-RPC body that may be JSON or an event stream. Injected from probe.ts. */
  parseBody: (body: string, contentType: string | null) => { result?: unknown; error?: { message?: string; code?: number } } | { parseError: string };
  /** Per-subject user-agent. See probe-identity.ts for why this is not a constant. */
  userAgent?: string;
  /**
   * DNS resolution, injected. guardedFetch resolves every hostname and refuses
   * addresses it will not talk to, so a caller supplying its own fetch has to
   * supply its own resolution too or the guard fails closed on a name that does
   * not exist.
   */
  resolver?: (h: string) => Promise<Array<{ address: string; family: number }>>;
};

export async function callTool(
  endpoint: string,
  declaration: ToolDeclaration,
  classification: ToolClassification,
  options: CallOptions,
): Promise<ToolCallResult> {
  assertCallable(classification);

  const { args } = synthesizeInput(declaration.inputSchema);
  const base: ToolCallResult = {
    tool: declaration.name,
    shape: classification.shape,
    basis: classification.binding.kind === "read_only" ? classification.binding.basis : "n/a",
    args,
    ok: false,
    isError: null,
    reason: null,
    elapsedMs: 0,
    responseBytes: 0,
    contentTypes: [],
    structuredContent: false,
    matchesOutputSchema: null,
    textSample: null,
    text: null,
    textTruncated: false,
    textFingerprint: null,
    substantive: false,
    errorInPayload: false,
    refused: false,
  };

  const headers: Record<string, string> = {
    "content-type": "application/json",
    accept: "application/json, text/event-stream",
    "mcp-protocol-version": PROTOCOL_VERSION,
    "user-agent": options.userAgent ?? USER_AGENT,
  };
  if (options.sessionId != null) headers["mcp-session-id"] = options.sessionId;

  const res = await guardedFetch(endpoint, {
    method: "POST",
    headers,
    // A random id per call. Every tools/call used the literal 9, which no real
    // client does and which is trivial to match on.
    body: JSON.stringify({ jsonrpc: "2.0", id: requestId(), method: "tools/call", params: { name: declaration.name, arguments: args } }),
    timeoutMs: options.timeoutMs ?? 15_000,
    maxBytes: options.maxBytes ?? 2 * 1024 * 1024,
    ...(options.fetchImpl === undefined ? {} : { fetchImpl: options.fetchImpl }),
    ...(options.resolver === undefined ? {} : { resolver: options.resolver }),
  });

  if (!res.ok) return { ...base, reason: res.reason, elapsedMs: res.elapsedMs };

  const parsed = options.parseBody(res.body, res.headers.get("content-type"));
  const common = { elapsedMs: res.elapsedMs, responseBytes: res.body.length };
  if ("parseError" in parsed) return { ...base, ...common, reason: parsed.parseError };
  if (parsed.error !== undefined) {
    return { ...base, ...common, reason: `jsonrpc error: ${parsed.error.message ?? parsed.error.code ?? "unknown"}` };
  }

  const result = (parsed.result ?? {}) as Record<string, unknown>;
  const content = Array.isArray(result.content) ? result.content : [];
  const contentTypes = [
    ...new Set(
      content
        .map((c) => (typeof c === "object" && c !== null ? String((c as Record<string, unknown>).type ?? "unknown") : "unknown")),
    ),
  ].sort();
  const text = content
    .filter((c): c is Record<string, unknown> => typeof c === "object" && c !== null && (c as Record<string, unknown>).type === "text")
    .map((c) => String(c.text ?? ""))
    .join("\n");

  // isError is the tool saying "I failed" inside a successful transport
  // response. A tool that reports failure honestly is behaving correctly at
  // the protocol level and badly at the task level, and conflating the two
  // would make a well-behaved error indistinguishable from a broken server.
  const isError = typeof result.isError === "boolean" ? result.isError : false;

  const structured = typeof result.structuredContent === "object" && result.structuredContent !== null;
  let matchesOutputSchema: boolean | null = null;
  if (declaration.outputSchema != null) {
    const need = requiredKeys(declaration.outputSchema);
    matchesOutputSchema = structured
      ? need.every((k) => Object.hasOwn(result.structuredContent as Record<string, unknown>, k))
      : false;
  }

  // A payload that reads as an error while the envelope says success. Common
  // enough to be worth naming: a tool reporting failure without using the
  // protocol's own mechanism is a conformance defect, and treating its output
  // as an answer would poison every comparison downstream.
  const head = text.slice(0, 400);
  const errorInPayload = ERROR_PAYLOAD.test(head);
  const normalized = text.replace(/\s+/g, " ").trim();
  const refused = REFUSAL.test(head) || EMPTY_PROSE.test(normalized);
  const empty = normalized.length === 0 || EMPTY_RESULT.test(normalized);
  const substantive = !isError && !errorInPayload && !refused && !empty && normalized.length > 0;

  return {
    ...base,
    ...common,
    ok: true,
    isError,
    contentTypes,
    structuredContent: structured,
    matchesOutputSchema,
    textSample: text.length > 0 ? text.slice(0, 300) : null,
    text: text.length > 0 ? text.slice(0, MAX_STORED_TEXT) : null,
    textTruncated: text.length > MAX_STORED_TEXT,
    textFingerprint: text.length > 0 ? createHash("sha256").update(normalized).digest("hex").slice(0, 32) : null,
    substantive,
    errorInPayload,
    refused,
  };
}

/**
 * How much of a response we keep.
 *
 * 32 KB. Big enough that cutting is rare, small enough that one 111 KB
 * response — an actual observation from a live run — cannot dominate a
 * transcript file.
 */
const MAX_STORED_TEXT = 32_000;

/** A payload that is really an error, whatever the envelope claimed. */
const ERROR_PAYLOAD =
  /("error"\s*:\s*"[^"]|\berror \d{3}\b|^mcp error|^upstream_error|^error:|^error executing|\bexception\b|\btraceback\b)/i;

/**
 * A response that declines rather than answers.
 *
 * Widened after an audit found seven of eight "fabrication" findings were
 * false positives, and most of them were refusals this list did not recognise.
 * Servers decline in JSON as readily as in prose: {"status":"declined"},
 * {"ok":false,"status":"target_rejected"}, {"result_type":"unknown"},
 * {"found":false}. A refusal is not an answer, and treating one as an answer
 * turns every honest "no" into an accusation of inventing things.
 */
const REFUSAL =
  /("(status|result_type|state)"\s*:\s*"(declined|rejected|target_rejected|unknown|not_found|none|error|failed)"|"(ok|success|found|valid)"\s*:\s*false|"reason"\s*:\s*"(negative_cache|not_found|no_match)")/i;

/**
 * A response that is an honest "nothing here", in JSON or in prose.
 *
 * The prose forms matter as much as the structured ones. "Nothing published on
 * X. Try a broader term." is a correct empty result and was being read as
 * substantive content because it is long enough to look like one.
 */
const EMPTY_RESULT =
  /^(\[\]|\{\}|null|none|no results?\.?|not found\.?|\{"results?":\s*\[\]\})$/i;
const EMPTY_PROSE =
  /^(no |nothing |not a valid|could not find|couldn.t find|there (are|were) no |0 results)|\b(no (results?|matches?|records?|entries|data) (found|available|published)|nothing (found|published|available)|try a broader)/i;
