/**
 * SSE frame parsing.
 *
 * These matter because the transport was invisible for so long: 748 servers
 * declared `sse` and 74% of them were recorded as broken, against 16% for
 * streamable-http. Servers answering 200 with a well-formed endpoint event were
 * filed as "HTTP 404". The parser is now the thing standing between us and
 * repeating that.
 */
import { describe, expect, it } from "vitest";
import { parseFrames, probeViaSse } from "../src/mcp/sse.js";
import type { PinnedTransport } from "../src/net.js";

describe("parseFrames", () => {
  it("reads the endpoint event that names where to POST", () => {
    const { frames } = parseFrames("event: endpoint\ndata: /messages?sessionId=abc\n\n");
    expect(frames).toEqual([{ event: "endpoint", data: "/messages?sessionId=abc" }]);
  });

  it("keeps a partial frame back rather than parsing half a message", () => {
    // A chunk boundary mid-frame must not produce a truncated JSON body.
    const { frames, rest } = parseFrames('event: message\ndata: {"id":1,"resu');
    expect(frames).toEqual([]);
    expect(rest).toBe('event: message\ndata: {"id":1,"resu');
  });

  it("joins multi-line data with newlines, per the SSE spec", () => {
    // Getting this wrong truncates any JSON body long enough to wrap.
    const { frames } = parseFrames('data: {"a":1,\ndata: "b":2}\n\n');
    expect(frames[0]?.data).toBe('{"a":1,\n"b":2}');
  });

  it("strips exactly one leading space after the colon, not all whitespace", () => {
    const { frames } = parseFrames("data:  two spaces\n\n");
    expect(frames[0]?.data).toBe(" two spaces");
  });

  it("handles CRLF, which real servers send", () => {
    const { frames } = parseFrames("event: endpoint\r\ndata: /m\r\n\r\n");
    expect(frames).toEqual([{ event: "endpoint", data: "/m" }]);
  });

  it("parses several frames arriving in one chunk", () => {
    const { frames } = parseFrames('event: endpoint\ndata: /m\n\ndata: {"id":1}\n\n');
    expect(frames).toHaveLength(2);
    expect(frames[1]?.data).toBe('{"id":1}');
  });

  it("defaults the event name to message when only data is sent", () => {
    const { frames } = parseFrames('data: {"id":7}\n\n');
    expect(frames[0]?.event).toBe("message");
  });
});

describe("legacy SSE safely sequences a real exchange", () => {
  it("resolves a relative endpoint event against the final redirected stream URL", async () => {
    let stream: ReadableStreamDefaultController<Uint8Array> | undefined;
    const posts: string[] = [];
    const result = await probeViaSse("https://203.0.113.10/old/sse", [{ id: 1, method: "initialize" }], {
      timeoutMs: 200,
      transport: async (url, init) => {
        if (url.endsWith("/old/sse")) return new Response(null, { status: 307,
          headers: { location: "https://203.0.113.20/new/sse" } });
        if (init.method === "GET") return new Response(new ReadableStream({ start(c) {
          stream = c;
          c.enqueue(new TextEncoder().encode("event: endpoint\ndata: messages\n\n"));
        } }), { headers: { "content-type": "text/event-stream" } });
        posts.push(url);
        stream!.enqueue(new TextEncoder().encode('data: {"jsonrpc":"2.0","id":1,"result":{}}\n\n'));
        return new Response(null, { status: 202 });
      },
    });
    expect(result.ok).toBe(true);
    expect(posts).toEqual(["https://203.0.113.20/new/messages"]);
  });
  it("keeps DNS inside the exchange deadline", async () => {
    const result = await Promise.race([
      probeViaSse("https://never-resolves.example/sse", [], { timeoutMs: 20,
        resolver: () => new Promise(() => {}), transport: async () => { throw new Error("must not dial"); } }),
      new Promise<null>((r) => setTimeout(() => r(null), 200)),
    ]);
    expect(result).not.toBeNull();
    expect(result?.ok).toBe(false);
    expect(result?.reason).toMatch(/deadline/);
  });
  it("re-vets a private endpoint event before any POST", async () => {
    let posts = 0;
    const out = await probeViaSse("https://203.0.113.10/sse", [{ id: 1, method: "initialize" }], {
      timeoutMs: 200,
      transport: async (_url, init) => {
        if (init.method === "POST") posts += 1;
        return new Response(new ReadableStream({ start(c) {
          c.enqueue(new TextEncoder().encode("event: endpoint\ndata: http://127.0.0.1/secret\n\n"));
        } }), { headers: { "content-type": "text/event-stream" } });
      },
    });
    expect(posts).toBe(0);
    expect(out.ok).toBe(false);
    expect(out.reason).toMatch(/blocked/);
  });
  it("waits for initialize, omits notification ids, and strips credentials on an endpoint event", async () => {
    let stream: ReadableStreamDefaultController<Uint8Array> | undefined;
    let initializedReplySent = false;
    let postedBeforeInitialize = false;
    const posts: Array<{ url: string; headers: Record<string, string>; body: Record<string, unknown> }> = [];
    const encode = (body: unknown) => new TextEncoder().encode(`data: ${JSON.stringify(body)}\n\n`);
    const transport: PinnedTransport = async (url, init) => {
      if (init.method === "GET") return new Response(new ReadableStream({ start(c) {
        stream = c;
        c.enqueue(new TextEncoder().encode("event: endpoint\ndata: https://203.0.113.20/messages\n\n"));
      } }), { headers: { "content-type": "text/event-stream" } });
      const body = JSON.parse(init.body!) as Record<string, unknown>;
      posts.push({ url, headers: init.headers, body });
      if (body.method === "initialize") {
        setTimeout(() => {
          initializedReplySent = true;
          stream!.enqueue(encode({ jsonrpc: "2.0", id: 1, result: { protocolVersion: "2025-06-18" } }));
        }, 10);
      } else {
        if (!initializedReplySent) postedBeforeInitialize = true;
        if (body.method === "tools/list") stream!.enqueue(encode({ jsonrpc: "2.0", id: 3, result: { tools: [] } }));
      }
      return new Response(null, { status: 202 });
    };
    const out = await probeViaSse("https://203.0.113.10/sse", [
      { id: 1, method: "initialize", params: {} },
      { id: 2, method: "notifications/initialized" }, { id: 3, method: "tools/list" },
    ], { timeoutMs: 300, headers: { authorization: "secret", "mcp-session-id": "session" }, transport });
    expect(out.replies.has(3)).toBe(true);
    expect(postedBeforeInitialize).toBe(false);
    expect(posts[1]?.body).not.toHaveProperty("id");
    expect(posts.every((p) => p.headers.authorization === undefined && p.headers["mcp-session-id"] === undefined)).toBe(true);
  });
});
