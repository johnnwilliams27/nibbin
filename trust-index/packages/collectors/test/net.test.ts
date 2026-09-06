/**
 * The network guard. Every URL a collector fetches was chosen by someone else,
 * so these are the tests that stop a ratings run from becoming an SSRF probe
 * of our own network.
 */
import { describe, expect, it } from "vitest";
import { guardedFetch, isBlockedHost, vetUrl, vetResolved } from "../src/net.js";
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

/** Every host in these tests resolves publicly, so they run offline. */
const publicDns = async () => [{ address: "93.184.216.34", family: 4 }];

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

    const res = await guardedFetch("https://example.com/mcp", { fetchImpl, resolver: publicDns });
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
    const res = await guardedFetch("https://example.com/mcp", { fetchImpl, resolver: publicDns });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.body).toBe('{"ok":true}');
  });

  it("stops after the redirect limit rather than looping", async () => {
    const fetchImpl = (async () =>
      response({ status: 302, headers: { location: "https://example.com/again" } })) as unknown as typeof fetch;
    const res = await guardedFetch("https://example.com/mcp", { fetchImpl, maxRedirects: 2, resolver: publicDns });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toMatch(/more than 2 redirects/);
  });

  it("rejects an oversize body on its declared length", async () => {
    const fetchImpl = (async () =>
      response({ headers: { "content-length": "999999" } })) as unknown as typeof fetch;
    const res = await guardedFetch("https://example.com/x", { fetchImpl, maxBytes: 1024, resolver: publicDns });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toMatch(/over 1024 bytes/);
  });

  it("rejects an oversize body that declared no length", async () => {
    const fetchImpl = (async () => response({ body: "x".repeat(5000) })) as unknown as typeof fetch;
    const res = await guardedFetch("https://example.com/x", { fetchImpl, maxBytes: 1024, resolver: publicDns });
    expect(res.ok).toBe(false);
  });

  it("returns a failure instead of throwing when the request errors", async () => {
    const fetchImpl = (async () => {
      throw new Error("ECONNREFUSED");
    }) as unknown as typeof fetch;
    const res = await guardedFetch("https://example.com/x", { fetchImpl, resolver: publicDns });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toMatch(/ECONNREFUSED/);
  });

  it("reports an HTTP error status as a failure with its status", async () => {
    const fetchImpl = (async () => response({ status: 503, body: "nope" })) as unknown as typeof fetch;
    const res = await guardedFetch("https://example.com/x", { fetchImpl, resolver: publicDns });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.status).toBe(503);
      expect(res.reason).toBe("HTTP 503");
    }
  });
});

/**
 * A hostname is not an address.
 *
 * `localtest.me` is a public DNS name that resolves to 127.0.0.1, and anyone
 * can publish such a record. Every literal check in this file passes it,
 * because there is nothing wrong with the string. The endpoints we probe come
 * from a public registry, so this is the shape of a live blind-POST SSRF
 * against our own network.
 *
 * Resolution is injected here rather than performed, so these run offline and
 * do not depend on what a real resolver happens to return today.
 */
describe("names are resolved and the addresses vetted", () => {
  const resolves = (...addresses: string[]) =>
    async () => addresses.map((address) => ({ address, family: address.includes(":") ? 6 : 4 }));

  it("refuses a public name that resolves to loopback", async () => {
    const v = await vetResolved("localtest.me", resolves("127.0.0.1"));
    expect(v.allowed).toBe(false);
    expect(v.allowed === false && v.reason).toMatch(/127\.0\.0\.1/);
  });

  it.each([
    ["cloud metadata", "169.254.169.254"],
    ["private", "10.1.2.3"],
    ["private", "192.168.0.5"],
    ["carrier-grade NAT", "100.100.1.1"],
    ["IPv6 loopback", "::1"],
    ["IPv6 unique-local", "fd00::1"],
  ])("refuses a name resolving to %s", async (_label, address) => {
    expect((await vetResolved("evil.example", resolves(address))).allowed).toBe(false);
  });

  it("refuses a name that resolves to a public AND a private address", async () => {
    // The rebinding-adjacent case: a record mixing the two is not something to
    // race against, and no legitimate host publishes one.
    expect((await vetResolved("split.example", resolves("93.184.216.34", "127.0.0.1"))).allowed).toBe(false);
  });

  it("allows an ordinary public name", async () => {
    expect((await vetResolved("example.com", resolves("93.184.216.34"))).allowed).toBe(true);
  });

  it("does not resolve an IP literal, which was already vetted", async () => {
    let called = false;
    const spy = async () => { called = true; return []; };
    expect((await vetResolved("93.184.216.34", spy)).allowed).toBe(true);
    expect((await vetResolved("[2606:2800:220:1:248:1893:25c8:1946]", spy)).allowed).toBe(true);
    expect(called).toBe(false);
  });

  it("treats a resolution failure as our inability to reach, not a finding", async () => {
    const v = await vetResolved("nxdomain.example", async () => { throw new Error("ENOTFOUND"); });
    expect(v.allowed).toBe(false);
    expect(v.allowed === false && v.reason).toMatch(/dns lookup failed/);
  });

  it("blocks a redirect to a name that resolves privately", async () => {
    // Same attack with an extra step, so the check runs on every hop.
    const fetchImpl = (async (url: string) =>
      url.includes("start")
        ? new Response(null, { status: 302, headers: { location: "https://inner.example/" } })
        : new Response("secret", { status: 200 })) as unknown as typeof fetch;
    const out = await guardedFetch("https://start.example/", {
      fetchImpl,
      resolver: async (h) => [{ address: h === "inner.example" ? "127.0.0.1" : "93.184.216.34", family: 4 }],
    });
    expect(out.ok).toBe(false);
    expect(out.ok === false && out.reason).toMatch(/blocked address/);
  });
});
