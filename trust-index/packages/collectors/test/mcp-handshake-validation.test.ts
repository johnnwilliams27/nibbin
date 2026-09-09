import { describe, expect, it } from "vitest";
import { probeMcpServer } from "../src/mcp/probe.js";

const initialize = { jsonrpc: "2.0", id: 1, result: {
  protocolVersion: "2025-06-18", serverInfo: { name: "fixture", version: "1" }, capabilities: {},
} };

async function probe(reply: unknown, list: unknown = { jsonrpc: "2.0", id: 2, result: { tools: [] } }) {
  // Only the socket boundary is fake. A public literal skips DNS; no network I/O.
  const fetchImpl = (async (_url: unknown, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as { method: string };
    if (body.method === "notifications/initialized") return new Response(null, { status: 202 });
    return new Response(JSON.stringify(body.method === "initialize" ? reply : list), {
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
  return probeMcpServer("https://203.0.113.10/mcp", null, { attempts: 1, fetchImpl });
}

describe("MCP requires a matching, shaped protocol reply", () => {
  it.each([{}, [], null, true, "a web page", { message: "welcome" },
    { ...initialize, id: 99 }, { ...initialize, jsonrpc: "1.0" },
    { ...initialize, result: {} },
    { ...initialize, result: { ...initialize.result, capabilities: null } },
    { ...initialize, result: { ...initialize.result, protocolVersion: "" } },
  ])("does not establish a handshake from %j", async (reply) => {
    const t = await probe(reply);
    expect(t.handshake?.ok).toBe(false);
    expect(t.tools).toBeNull();
    expect(t.attempts[0]?.status).toBe(200);
  });

  it("retains valid handshakes and an explicitly empty tool list", async () => {
    const t = await probe(initialize);
    expect(t.handshake?.ok).toBe(true);
    expect(t.tools).toEqual({ ok: true, declared: [], reason: null });
  });

  it.each([{}, { jsonrpc: "2.0", id: 2, result: {} },
    { jsonrpc: "2.0", id: 99, result: { tools: [] } },
    { jsonrpc: "2.0", id: 2, result: { tools: [null] } },
    { jsonrpc: "2.0", id: 2, result: { tools: [{ name: "" }] } },
  ])("does not call a missing or mismatched tool list empty: %j", async (reply) => {
    const t = await probe(initialize, reply);
    expect(t.handshake?.ok).toBe(true);
    expect(t.tools?.ok).toBe(false);
  });
});
