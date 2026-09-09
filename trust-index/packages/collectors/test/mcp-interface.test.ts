import { describe, expect, it } from "vitest";
import { declaredProbeTargets, probeMcpInterface } from "../src/mcp/interface.js";
import type { SseProbeResult } from "../src/mcp/sse.js";
import { assessmentFor } from "../scripts/merge-marketplace-assessments.mjs";

const descriptor = { type: "https://eips.ethereum.org/EIPS/eip-8004#service.mcp", name: "fixture/local",
  version: "1.0", transport: "stdio", install: { npx: "NEVER EXECUTE THIS" },
  tools: [{ name: "get_balance", description: "Read the balance", inputSchema: { type: "object" } }] };
const initReply = { jsonrpc: "2.0", id: 1, result: { protocolVersion: "2025-06-18",
  capabilities: { tools: {} }, serverInfo: { name: "fixture", version: "1" } } };
const sse: SseProbeResult = { ok: true, messageUrl: "https://203.0.113.10/messages",
  replies: new Map<number, unknown>([[1, initReply], [3, { jsonrpc: "2.0", id: 3, result: { tools: descriptor.tools } }]]),
  status: 200, reason: null, elapsedMs: 4, authStatus: null, wwwAuthenticate: null };

describe("MCP interface discovery", () => {
  it("plans the agent-specific A2A URL instead of sending A2A to its MCP URL", () => {
    expect(declaredProbeTargets({ endpoint: "https://fixture.example/mcp", protocols: ["MCP", "A2A"],
      declared_interfaces: [{ protocol: "mcp", endpoint: "https://fixture.example/mcp" },
        { protocol: "a2a", endpoint: "https://fixture.example/agents/1/card" }] })).toEqual([
      { endpoint: "https://fixture.example/mcp", protocols: ["MCP"] },
      { endpoint: "https://fixture.example/agents/1/card", protocols: ["A2A"] },
    ]);
  });
  it("reads an explicit stdio descriptor without POSTing or executing its installation command", async () => {
    const methods: string[] = [];
    const fetchImpl = (async (_url: unknown, init?: RequestInit) => {
      methods.push(init?.method ?? "GET");
      return new Response(JSON.stringify(descriptor), { headers: { "content-type": "application/json" } });
    }) as typeof fetch;
    const t = await probeMcpInterface("https://203.0.113.10/api/mcp/info", null, { attempts: 1, fetchImpl });
    expect(methods).toEqual(["GET"]);
    expect(t.transport).toBe("stdio");
    expect(t.handshake).toBeNull();
    expect(t.tools).toBeNull();
    expect(t.service_descriptor?.tools[0]?.name).toBe("get_balance");
    expect(t.service_descriptor?.body_sha256).toMatch(/^[a-f0-9]{64}$/);
    const a = assessmentFor({ endpoint: t.endpoint, host: "203.0.113.10", protocols: ["MCP"],
      priority: 0, agent_count: 1, mcp: t, a2a: null, probed_at: t.probed_at });
    expect(a).toMatchObject({ evidence_state: "descriptor_read", evidence_provenance: "self_reported",
      capability_source: "service_descriptor", protocol_spoken: null, composite: null });
    expect(a.tools_or_skills).toEqual(["get_balance"]);
  });
  it("uses shared legacy SSE after HTTP405 and retains the original attempt", async () => {
    const fetchImpl = (async () => new Response("not here", { status: 405 })) as typeof fetch;
    const t = await probeMcpInterface("https://203.0.113.10/sse", null,
      { attempts: 1, fetchImpl, sseProbe: async () => structuredClone(sse) });
    expect(t.transport).toBe("sse");
    expect(t.handshake?.ok).toBe(true);
    expect(t.tools?.declared[0]?.name).toBe("get_balance");
    expect(t.http_probe?.attempts[0]?.status).toBe(405);
  });
  it("does not convert a generic JSON document to a descriptor or handshake", async () => {
    const fetchImpl = (async () => new Response('{"name":"welcome","tools":[]}',
      { headers: { "content-type": "application/json" } })) as typeof fetch;
    const t = await probeMcpInterface("https://203.0.113.10/info", null,
      { attempts: 1, fetchImpl, sseProbe: async () => ({ ...sse, ok: false, replies: new Map(), messageUrl: null }) });
    expect(t.service_descriptor).toBeUndefined();
    expect(t.handshake?.ok).not.toBe(true);
  });
  it("rejects an SSE result without a matching shaped initialize response", async () => {
    const fetchImpl = (async () => new Response("", { status: 405 })) as typeof fetch;
    const t = await probeMcpInterface("https://203.0.113.10/sse", null,
      { attempts: 1, fetchImpl, sseProbe: async () => ({ ...sse, replies: new Map([[1, {}], [3, { result: { tools: [] } }]]) }) });
    expect(t.handshake?.ok).not.toBe(true);
  });
  it("does not try alternate transports after a rate limit or auth wall", async () => {
    for (const status of [401, 429]) {
      let extraCall = false;
      const t = await probeMcpInterface("https://203.0.113.10/mcp", null, { attempts: 1,
        fetchImpl: (async () => new Response("", { status })) as typeof fetch,
        sseProbe: async () => { extraCall = true; return sse; } });
      expect(extraCall).toBe(false);
      expect(t.handshake?.ok).toBe(false);
    }
  });
  it("does not POST after a descriptor GET is rate limited", async () => {
    const methods: string[] = [];
    const t = await probeMcpInterface("https://203.0.113.10/info", null, { attempts: 1,
      fetchImpl: (async (_url: unknown, init?: RequestInit) => {
        methods.push(init?.method ?? "GET");
        return new Response("", { status: 429 });
      }) as typeof fetch,
      sseProbe: async () => { throw new Error("must not bypass rate limiting"); } });
    expect(methods).toEqual(["GET"]);
    expect(t.rate_limit?.limited).toBe(true);
  });
});
