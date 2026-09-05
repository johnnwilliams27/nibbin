/**
 * Probing a remote MCP server.
 *
 * The protocol's Streamable HTTP transport is a POST of a JSON-RPC message to
 * one endpoint, and the reply is either a JSON body or an SSE stream carrying
 * the same message in a `data:` line. Both are accepted here, because a server
 * that answers correctly in either form is answering correctly, and a prober
 * that only understood one of them would report a conformance failure that
 * says more about the prober than the server.
 *
 * Everything is recorded, including failures and their reasons, and nothing is
 * judged. The rubric in assess.ts does the judging, from the transcript, so a
 * changed rubric does not mean re-probing anyone's server.
 *
 * Etiquette, since these are other people's servers: one connection at a
 * time per host, a short timeout, an identifying user agent, and no calls to
 * any tool. The probe reads declarations. It never invokes a tool, because
 * invoking an unknown tool on someone's production server to see what happens
 * is not something a ratings source gets to do.
 */
import { guardedFetch, vetUrl, type GuardedFetchOptions } from "../net.js";
import type { ProbeIdentity } from "./probe-identity.js";
import type { AuthResult, HandshakeResult, ProbeAttempt, ProbeTranscript, RegistryFacts, ToolDeclaration, ToolsResult } from "./transcript.js";

export const PROBE_ID = "probe:mcp:v1";
const PROTOCOL_VERSION = "2025-06-18";
/**
 * Fallback identity. The old value named this repository, handing every server
 * the source of the constants it was about to be tested with. Callers should
 * pass `identity` — see probe-identity.ts.
 */
const USER_AGENT = "mcp-client/1.0.0";

export type ProbeOptions = {
  /** Attempts to make when measuring availability. Each is a full handshake. */
  attempts?: number;
  timeoutMs?: number;
  /** Milliseconds between attempts, so a probe is not a burst. */
  spacingMs?: number;
  /** ISO-8601 UTC second-precision timestamp source. Injected so tests are deterministic. */
  nowIso?: () => string;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  /** Per-subject probe identity. See probe-identity.ts for why this is not a constant. */
  identity?: ProbeIdentity;
};

export function isoNow(): string {
  return `${new Date().toISOString().slice(0, 19)}Z`;
}

type JsonRpcReply = { result?: unknown; error?: { message?: string; code?: number } };

/**
 * Extract the JSON-RPC payload from a response body that may be plain JSON or
 * an SSE stream. An SSE frame's `data:` lines are concatenated per the spec
 * before parsing.
 */
export function parseRpcBody(body: string, contentType: string | null): JsonRpcReply | { parseError: string } {
  const looksSse = (contentType ?? "").includes("text/event-stream") || /^\s*(event|data):/m.test(body);
  if (looksSse) {
    const frames: string[] = [];
    let current: string[] = [];
    for (const rawLine of body.split(/\r?\n/)) {
      if (rawLine === "") {
        if (current.length > 0) frames.push(current.join("\n"));
        current = [];
        continue;
      }
      if (rawLine.startsWith("data:")) current.push(rawLine.slice(5).replace(/^ /, ""));
    }
    if (current.length > 0) frames.push(current.join("\n"));
    for (const frame of frames) {
      try {
        const parsed = JSON.parse(frame) as JsonRpcReply;
        // Skip frames that are not the reply we are waiting for (pings, logs).
        if (typeof parsed === "object" && parsed !== null && ("result" in parsed || "error" in parsed)) {
          return parsed;
        }
      } catch {
        /* keep looking: a malformed frame is not necessarily the reply */
      }
    }
    return { parseError: "no JSON-RPC frame in event stream" };
  }
  try {
    return JSON.parse(body) as JsonRpcReply;
  } catch (err) {
    return { parseError: err instanceof Error ? err.message.slice(0, 80) : "unparseable body" };
  }
}

function rpcBody(id: number | null, method: string, params: unknown): string {
  return JSON.stringify(
    id === null ? { jsonrpc: "2.0", method, params } : { jsonrpc: "2.0", id, method, params },
  );
}

function str(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

/** Read tool declarations out of a tools/list result without trusting its shape. */
export function readTools(result: unknown): ToolDeclaration[] {
  if (typeof result !== "object" || result === null) return [];
  const list = (result as Record<string, unknown>).tools;
  if (!Array.isArray(list)) return [];
  const out: ToolDeclaration[] = [];
  for (const item of list) {
    if (typeof item !== "object" || item === null) continue;
    const t = item as Record<string, unknown>;
    out.push({
      name: typeof t.name === "string" ? t.name : "",
      description: str(t.description),
      inputSchema: t.inputSchema ?? null,
      outputSchema: t.outputSchema ?? null,
      annotations: t.annotations ?? null,
    });
  }
  return out;
}

export async function probeMcpServer(
  endpoint: string,
  registry: RegistryFacts | null,
  options: ProbeOptions = {},
): Promise<ProbeTranscript> {
  const attemptCount = options.attempts ?? 3;
  const identity = options.identity;
  const nowIso = options.nowIso ?? isoNow;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const spacingMs = options.spacingMs ?? 400;
  const probedAt = nowIso();

  const base: Omit<GuardedFetchOptions, "body"> = {
    method: "POST",
    timeoutMs: options.timeoutMs ?? 10_000,
    ...(options.fetchImpl === undefined ? {} : { fetchImpl: options.fetchImpl }),
  };

  const attempts: ProbeAttempt[] = [];
  let handshake: HandshakeResult | null = null;
  let tools: ToolsResult | null = null;
  let sessionId: string | null = null;
  let auth: AuthResult | null = null;

  const vetted = vetUrl(endpoint);
  if (!vetted.allowed) {
    // A refused endpoint is not an unreachable server: it is an endpoint we
    // will not fetch. Recorded as a single failed attempt with the reason, so
    // a reader can tell the two apart.
    return {
      transcript_version: "1",
      probe_id: PROBE_ID,
      endpoint,
      probed_at: probedAt,
      attempts: [
        { attempt: 1, ts: probedAt, reachable: false, status: null, reason: `refused: ${vetted.reason}`, elapsedMs: 0 },
      ],
      handshake: null,
      tools: null,
      registry,
      auth: null,
    };
  }

  for (let i = 1; i <= attemptCount; i += 1) {
    if (i > 1) await sleep(spacingMs);
    const ts = nowIso();
    const headers: Record<string, string> = {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      "mcp-protocol-version": PROTOCOL_VERSION,
      "user-agent": identity?.userAgent ?? USER_AGENT,
    };
    if (sessionId !== null) headers["mcp-session-id"] = sessionId;

    const res = await guardedFetch(endpoint, {
      ...base,
      headers,
      body: rpcBody(1, "initialize", {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: {},
        // Announcing ourselves as a probe invites special treatment, which is
        // precisely the behaviour the rating is supposed to detect.
        clientInfo: { name: identity?.clientName ?? "mcp-client", version: identity?.clientVersion ?? "1.0.0" },
      }),
    });

    if (!res.ok) {
      // 401 and 403 mean the endpoint ANSWERED and declined us. That is
      // availability evidence, not its absence: the server is up and doing its
      // job. Everything downstream of the handshake becomes unassessable, and
      // the rubric turns that into a harness gap rather than a failing score.
      if (res.status === 401 || res.status === 403) {
        auth = { required: true, status: res.status, scheme: null };
        attempts.push({ attempt: i, ts, reachable: true, status: res.status, reason: null, elapsedMs: res.elapsedMs });
        if (handshake === null) {
          handshake = {
            ok: false,
            protocolVersion: null,
            serverName: null,
            serverVersion: null,
            instructions: null,
            reason: `authentication required (HTTP ${res.status})`,
          };
        }
        continue;
      }
      attempts.push({ attempt: i, ts, reachable: false, status: res.status, reason: res.reason, elapsedMs: res.elapsedMs });
      continue;
    }
    attempts.push({ attempt: i, ts, reachable: true, status: res.status, reason: null, elapsedMs: res.elapsedMs });
    if (auth === null) auth = { required: false, status: res.status, scheme: null };

    // Only the first successful attempt needs the protocol work; the rest are
    // measuring availability and should not hammer the server further.
    if (handshake !== null) continue;

    sessionId = res.headers.get("mcp-session-id");
    const parsed = parseRpcBody(res.body, res.headers.get("content-type"));
    if ("parseError" in parsed) {
      handshake = {
        ok: false,
        protocolVersion: null,
        serverName: null,
        serverVersion: null,
        instructions: null,
        reason: parsed.parseError,
      };
      continue;
    }
    if (parsed.error !== undefined) {
      handshake = {
        ok: false,
        protocolVersion: null,
        serverName: null,
        serverVersion: null,
        instructions: null,
        reason: `initialize error: ${parsed.error.message ?? String(parsed.error.code ?? "unknown")}`.slice(0, 120),
      };
      continue;
    }
    const result = (parsed.result ?? {}) as Record<string, unknown>;
    const serverInfo = (typeof result.serverInfo === "object" && result.serverInfo !== null
      ? result.serverInfo
      : {}) as Record<string, unknown>;
    handshake = {
      ok: true,
      protocolVersion: str(result.protocolVersion),
      serverName: str(serverInfo.name),
      serverVersion: str(serverInfo.version),
      instructions: str(result.instructions),
      reason: null,
    };

    // The spec requires the initialized notification before other requests.
    const notifyHeaders: Record<string, string> = { ...headers };
    if (sessionId !== null) notifyHeaders["mcp-session-id"] = sessionId;
    await guardedFetch(endpoint, {
      ...base,
      headers: notifyHeaders,
      body: rpcBody(null, "notifications/initialized", {}),
    });

    const listed = await guardedFetch(endpoint, {
      ...base,
      headers: notifyHeaders,
      body: rpcBody(2, "tools/list", {}),
    });
    if (!listed.ok) {
      tools = { ok: false, declared: [], reason: listed.reason };
      continue;
    }
    const listParsed = parseRpcBody(listed.body, listed.headers.get("content-type"));
    if ("parseError" in listParsed) {
      tools = { ok: false, declared: [], reason: listParsed.parseError };
    } else if (listParsed.error !== undefined) {
      tools = {
        ok: false,
        declared: [],
        reason: `tools/list error: ${listParsed.error.message ?? String(listParsed.error.code ?? "unknown")}`.slice(0, 120),
      };
    } else {
      tools = { ok: true, declared: readTools(listParsed.result), reason: null };
    }
  }

  return {
    transcript_version: "1",
    probe_id: PROBE_ID,
    endpoint,
    probed_at: probedAt,
    attempts,
    handshake,
    tools,
    registry,
    auth,
  };
}
