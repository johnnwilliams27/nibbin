/** Marketplace transport orchestration; no tool is invoked or package installed. */
import { createHash } from "node:crypto";
import { guardedFetch, vetUrl } from "../net.js";
import { probeMcpServer, validInitializeReply, validToolsReply, readTools, isoNow, type ProbeOptions } from "./probe.js";
import type { ProbeTranscript, RegistryFacts, ToolDeclaration } from "./transcript.js";
import { probeViaSse, type SseProbeResult } from "./sse.js";

export type ServiceDescriptor = {
  type: string;
  name: string;
  version: string | null;
  transport: "stdio";
  tools: ToolDeclaration[];
  source_url: string;
  checked_at: string;
  body_sha256: string;
  body: string;
};
export type InterfaceTranscript = ProbeTranscript & {
  transport?: "streamable-http" | "sse" | "stdio";
  service_descriptor?: ServiceDescriptor;
  http_probe?: ProbeTranscript;
  sse_probe?: Omit<SseProbeResult, "replies"> & { replies: Array<[number, unknown]> };
};
export type InterfaceProbeOptions = ProbeOptions & { sseProbe?: typeof probeViaSse };

export type DeclaredEndpoints = {
  endpoint: string | null;
  protocols: string[];
  declared_interfaces?: Array<{ protocol: string; endpoint: string }>;
};

export function declaredProbeTargets(agent: DeclaredEndpoints): Array<{ endpoint: string; protocols: string[] }> {
  const byUrl = new Map<string, string[]>();
  for (const entry of agent.declared_interfaces ?? []) {
    if (typeof entry?.endpoint !== "string" || typeof entry?.protocol !== "string" || entry.endpoint.trim() === "") continue;
    const endpoint = entry.endpoint.trim();
    const protocols = byUrl.get(endpoint) ?? [];
    const protocol = entry.protocol.toUpperCase();
    if (!protocols.includes(protocol)) protocols.push(protocol);
    byUrl.set(endpoint, protocols);
  }
  const legacy = agent.endpoint?.trim();
  if (legacy && !byUrl.has(legacy)) byUrl.set(legacy, [...agent.protocols]);
  return [...byUrl].map(([endpoint, protocols]) => ({ endpoint, protocols }));
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseServiceDescriptor(body: string, endpoint: string, checkedAt: string): ServiceDescriptor | null {
  let doc: unknown;
  try { doc = JSON.parse(body); } catch { return null; }
  if (!record(doc) || doc.type !== "https://eips.ethereum.org/EIPS/eip-8004#service.mcp" ||
      doc.transport !== "stdio" || typeof doc.name !== "string" || doc.name.trim() === "" ||
      !Array.isArray(doc.tools) || !doc.tools.every((t) => record(t) && typeof t.name === "string" && t.name.trim() !== "")) return null;
  return { type: doc.type, name: doc.name, version: typeof doc.version === "string" ? doc.version : null,
    transport: "stdio", tools: readTools({ tools: doc.tools }), source_url: endpoint, checked_at: checkedAt,
    body_sha256: createHash("sha256").update(body).digest("hex"), body };
}

async function readDescriptor(endpoint: string, options: InterfaceProbeOptions): Promise<InterfaceTranscript | null> {
  const checkedAt = (options.nowIso ?? isoNow)();
  const res = await guardedFetch(endpoint, {
    method: "GET", timeoutMs: Math.min(options.timeoutMs ?? 10_000, 3000), maxBytes: 256 * 1024,
    headers: { accept: "application/json", "user-agent": "Nibbin Trust Index (https://nibbin.com)" },
    ...(options.fetchImpl === undefined ? {} : { fetchImpl: options.fetchImpl }),
    ...(options.resolver === undefined ? {} : { resolver: options.resolver }),
  });
  if (res.status === 401 || res.status === 403 || res.status === 429) {
    return {
      transcript_version: "1", probe_id: "probe:mcp-interface:v1", endpoint, probed_at: checkedAt,
      attempts: [{ attempt: 1, ts: checkedAt, status: res.status, reachable: true, reason: null, elapsedMs: res.elapsedMs }],
      handshake: null, tools: null, registry: null,
      auth: res.status === 429 ? null : { required: true, status: res.status,
        scheme: res.headers?.get("www-authenticate") ?? null },
      rate_limit: res.status === 429 ? { limited: true, status: 429 } : null,
    };
  }
  if (!res.ok) return null;
  const descriptor = parseServiceDescriptor(res.body, endpoint, checkedAt);
  if (descriptor === null) return null;
  return {
    transcript_version: "1", probe_id: "probe:mcp-interface:v1", endpoint, probed_at: checkedAt,
    attempts: [], handshake: null, tools: null, registry: null, auth: null, transport: "stdio",
    service_descriptor: descriptor,
  };
}

export async function probeMcpInterface(endpoint: string, registry: RegistryFacts | null,
  options: InterfaceProbeOptions = {}): Promise<InterfaceTranscript> {
  const vetted = vetUrl(endpoint);
  // Obvious descriptor paths are read first: never POST initialize at a known
  // stdio document, and never execute its install instructions.
  const documentPath = vetted.allowed && /(?:\/info\/?|\/descriptor\/?|\.json)$/i.test(vetted.url.pathname);
  if (documentPath) {
    const descriptor = await readDescriptor(endpoint, options);
    if (descriptor !== null) return { ...descriptor, registry };
  }
  const http = await probeMcpServer(endpoint, registry, options);
  if (http.handshake?.ok || http.auth?.required || http.rate_limit?.limited ||
      !http.attempts.some((a) => a.status !== null && a.status < 500)) return http;
  if (!documentPath) {
    const descriptor = await readDescriptor(endpoint, options);
    if (descriptor !== null) return { ...descriptor, registry, http_probe: http };
  }
  const sse = await (options.sseProbe ?? probeViaSse)(endpoint, [
    { id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {},
      clientInfo: { name: "Nibbin Trust Index", version: "1.0.0" } } },
    { id: 2, method: "notifications/initialized", params: {} },
    { id: 3, method: "tools/list", params: {} },
  ], { timeoutMs: options.timeoutMs ?? 12_000, maxBytes: 512 * 1024,
    headers: { "user-agent": "Nibbin Trust Index (https://nibbin.com)" } });
  const init = sse.replies.get(1);
  const list = sse.replies.get(3);
  const retained = { ...sse, replies: [...sse.replies.entries()] };
  if (!sse.ok || !validInitializeReply(init, 1)) {
    // Retain the original HTTP result, plus every fallback result. An auth
    // refusal on the GET does not establish an MCP protocol either.
    return { ...http, sse_probe: retained,
      ...(sse.authStatus === null ? {} : { auth: { required: true, status: sse.authStatus,
        scheme: sse.wwwAuthenticate, hop: "initialize" as const } }) };
  }
  const result = (init as { result: Record<string, unknown> }).result;
  const server = result.serverInfo as { name: string; version: string };
  const listed = validToolsReply(list, 3);
  return {
    ...http, transport: "sse", http_probe: http, sse_probe: retained,
    attempts: [{ attempt: 1, ts: http.probed_at, reachable: true, status: sse.status,
      reason: null, elapsedMs: sse.elapsedMs }],
    handshake: { ok: true, protocolVersion: result.protocolVersion as string,
      serverName: server.name, serverVersion: server.version,
      instructions: typeof result.instructions === "string" ? result.instructions : null, reason: null },
    tools: listed ? { ok: true, declared: readTools((list as { result: unknown }).result), reason: null }
      : { ok: false, declared: [], reason: "SSE tools/list did not return a matching tools array" },
    auth: { required: false, status: sse.status, scheme: null, hop: "initialize" },
  };
}
