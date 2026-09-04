/**
 * The network guard. Every URL a collector fetches was chosen by someone else,
 * so these are the tests that stop a ratings run from becoming an SSRF probe
 * of our own network.
 */
import { describe, expect, it } from "vitest";
import { guardedFetch, isBlockedHost, vetUrl } from "../src/net.js";
import { isBlockedHost as indexerIsBlockedHost } from "../../indexer/src/metadata.js";

const BLOCKED = [
  "localhost",
  "app.localhost",
  "127.0.0.1",
  "127.1.2.3",
  "0.0.0.0",
  "10.0.0.1",
  "172.16.4.4",
  "172.31.255.255",
  "192.168.1.1",
  "169.254.169.254",
  "100.64.0.1",
  "224.0.0.1",
  "255.255.255.255",
  "[::1]",
  "[::]",
  "[fe80::1]",
  "[fc00::1]",
  "[fd12:3456::1]",
  "[64:ff9b::1]",
  "[::ffff:a9fe:a9fe]",
  "[::127.0.0.1]",
];

const ALLOWED = ["example.com", "8.8.8.8", "172.32.0.1", "192.169.1.1", "fc2.com", "[2606:4700::1]"];

describe("isBlockedHost", () => {
  it("blocks loopback, private, link-local and metadata addresses", () => {
    for (const h of BLOCKED) expect(isBlockedHost(h), h).toBe(true);
  });

  it("allows ordinary public hosts", () => {
    for (const h of ALLOWED) expect(isBlockedHost(h), h).toBe(false);
  });

  it("agrees with the chain indexer's guard on every case", () => {
    // Two copies of a security check are only safe while they are identical.
    // This is the test that keeps them so.
    for (const h of [...BLOCKED, ...ALLOWED]) {
      expect(isBlockedHost(h), h).toBe(indexerIsBlockedHost(h));
    }
  });
});

describe("vetUrl", () => {
  it("refuses non-http schemes", () => {
    for (const u of ["file:///etc/passwd", "gopher://x", "data:text/plain,hi"]) {
      const v = vetUrl(u);
      expect(v.allowed, u).toBe(false);
    }
  });

  it("refuses text that is not a URL", () => {
    expect(vetUrl("not a url").allowed).toBe(false);
  });

  it("accepts a public https endpoint", () => {
    const v = vetUrl("https://example.com/mcp");
    expect(v.allowed).toBe(true);
  });
});

function response(init: { status?: number; body?: string; headers?: Record<string, string> }): Response {
  return new Response(init.body ?? "{}", {
    status: init.status ?? 200,
    headers: init.headers ?? { "content-type": "application/json" },
  });
}

describe("guardedFetch", () => {
  it("re-runs the host guard on every redirect", async () => {
    // The bypass this exists to stop: a public hostname that 302s into the
    // internal network. A pre-request check alone would let it through.
    const seen: string[] = [];
    const fetchImpl = (async (url: string | URL) => {
      seen.push(String(url));
      if (seen.length === 1) {
        return response({ status: 302, headers: { location: "http://169.254.169.254/latest/meta-data/" } });
      }
      return response({ body: '{"secret":true}' });
    }) as unknown as typeof fetch;

    const res = await guardedFetch("https://example.com/mcp", { fetchImpl });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe("blocked host");
    expect(seen).toHaveLength(1);
  });

  it("follows an allowed redirect", async () => {
    const fetchImpl = (async (url: string | URL) => {
      if (String(url).endsWith("/mcp")) {
        return response({ status: 307, headers: { location: "https://other.example.com/v2" } });
      }
      return response({ body: '{"ok":true}' });
    }) as unknown as typeof fetch;
    const res = await guardedFetch("https://example.com/mcp", { fetchImpl });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.body).toBe('{"ok":true}');
  });

  it("stops after the redirect limit rather than looping", async () => {
    const fetchImpl = (async () =>
      response({ status: 302, headers: { location: "https://example.com/again" } })) as unknown as typeof fetch;
    const res = await guardedFetch("https://example.com/mcp", { fetchImpl, maxRedirects: 2 });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toMatch(/more than 2 redirects/);
  });

  it("rejects an oversize body on its declared length", async () => {
    const fetchImpl = (async () =>
      response({ headers: { "content-length": "999999" } })) as unknown as typeof fetch;
    const res = await guardedFetch("https://example.com/x", { fetchImpl, maxBytes: 1024 });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toMatch(/over 1024 bytes/);
  });

  it("rejects an oversize body that declared no length", async () => {
    const fetchImpl = (async () => response({ body: "x".repeat(5000) })) as unknown as typeof fetch;
    const res = await guardedFetch("https://example.com/x", { fetchImpl, maxBytes: 1024 });
    expect(res.ok).toBe(false);
  });

  it("returns a failure instead of throwing when the request errors", async () => {
    const fetchImpl = (async () => {
      throw new Error("ECONNREFUSED");
    }) as unknown as typeof fetch;
    const res = await guardedFetch("https://example.com/x", { fetchImpl });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toMatch(/ECONNREFUSED/);
  });

  it("reports an HTTP error status as a failure with its status", async () => {
    const fetchImpl = (async () => response({ status: 503, body: "nope" })) as unknown as typeof fetch;
    const res = await guardedFetch("https://example.com/x", { fetchImpl });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.status).toBe(503);
      expect(res.reason).toBe("HTTP 503");
    }
  });
});
