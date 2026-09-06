/**
 * The network guard. Every URL a collector fetches was chosen by someone else,
 * so these are the tests that stop a ratings run from becoming an SSRF probe
 * of our own network.
 */
import { createServer as createTcpServer, type Socket } from "node:net";
import { createServer as createHttpServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { lookup as dnsLookupCb } from "node:dns";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import { guardedFetch, isBlockedHost, pinnedFetch, vetUrl, vetResolved, type PinnedTransport } from "../src/net.js";
import { isBlockedHost as indexerIsBlockedHost } from "../../indexer/src/metadata.js";

const dnsLookup = promisify(dnsLookupCb);

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
  // A trailing root dot. `new URL("http://localhost./")` keeps it in .hostname,
  // so every suffix rule in the guard was one keystroke from being bypassed.
  "localhost.",
  "app.localhost.",
  "127.0.0.1.",
  // 6to4 carries an arbitrary IPv4 in the next 32 bits: loopback, and the
  // metadata address.
  "[2002:7f00:1::1]",
  "[2002:a9fe:a9fe::1]",
  // The unbracketed forms, which is how a resolver hands an address back.
  "::1",
  "fe80::1",
  "fd00::1",
  // A scope id is not part of the address and must not hide the prefix.
  "fe80::1%eth0",
];

/**
 * Blocked by the collector guard and not by the indexer's, which is a
 * hostname-suffix list the indexer has no equivalent of. Kept out of the
 * equality check and inside the "never weaker" one below, so the difference is
 * recorded rather than discovered.
 */
const BLOCKED_COLLECTOR_ONLY = [
  "db.internal",
  "db.internal.",
  "payments.svc.cluster.local",
  "payments.svc.cluster.local.",
  "printer.lan.",
  "nas.home.arpa.",
  "metadata.google.internal",
  "metadata.goog",
  "metadata",
];

const ALLOWED = [
  "example.com",
  // A public name with the root dot spelled out is still a public name.
  "example.com.",
  "8.8.8.8",
  "172.32.0.1",
  "192.169.1.1",
  "fc2.com",
  "[2606:4700::1]",
  "2606:4700::1",
];

describe("isBlockedHost", () => {
  it("blocks loopback, private, link-local and metadata addresses", () => {
    for (const h of BLOCKED) expect(isBlockedHost(h), h).toBe(true);
  });

  it("allows ordinary public hosts", () => {
    for (const h of ALLOWED) expect(isBlockedHost(h), h).toBe(false);
  });

  it("blocks the hostname suffixes the indexer has no list for", () => {
    for (const h of BLOCKED_COLLECTOR_ONLY) expect(isBlockedHost(h), h).toBe(true);
  });

  it("agrees with the chain indexer's guard on every case", () => {
    // Two copies of a security check are only safe while they are identical.
    // This is the test that keeps them so.
    for (const h of [...BLOCKED, ...ALLOWED]) {
      expect(isBlockedHost(h), h).toBe(indexerIsBlockedHost(h));
    }
  });

  it("is never weaker than the indexer's guard, on anything either one names", () => {
    // The equality above covers the shared list. This covers the rest: the
    // collector's guard may be stricter, never looser, so a case added to the
    // indexer alone cannot quietly become a hole here.
    for (const h of [...BLOCKED, ...BLOCKED_COLLECTOR_ONLY, ...ALLOWED]) {
      if (indexerIsBlockedHost(h)) expect(isBlockedHost(h), h).toBe(true);
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

  it("normalises every numeric spelling of an address before checking it", () => {
    // Decimal, octal, hex, short-form, and full-width digits are all 127.0.0.1
    // to the WHATWG parser and therefore to the guard. Pinned because a guard
    // that trusted the raw string would pass all five.
    for (const u of [
      "http://2130706433/",
      "http://0177.0.0.1/",
      "http://0x7f000001/",
      "http://127.1/",
      "http://\u2460\u2461\u2466.0.0.1/",
    ]) {
      expect(vetUrl(u).allowed, u).toBe(false);
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

/**
 * The socket goes where the check went.
 *
 * Vetting a name's addresses and then handing the NAME to an HTTP client leaves
 * the client to resolve it a second time, and nothing made the two answers
 * agree. That is DNS rebinding, and it was not theoretical here: with the
 * vetting resolver returning a public address and the system resolver returning
 * 127.0.0.1, `guardedFetch` returned the body of a loopback-only service.
 *
 * Everything below binds to loopback, dials loopback, and uses `.invalid` and
 * RFC-5737 documentation addresses for the names and addresses it must NOT
 * reach. Nothing leaves this machine.
 */
const servers: Array<Server | ReturnType<typeof createTcpServer>> = [];
afterEach(async () => {
  await Promise.all(
    servers.splice(0).map((s) => new Promise<void>((r) => { s.close(() => r()); s.unref(); })),
  );
});

async function loopbackServer(
  handler: (req: IncomingMessage, res: ServerResponse) => void,
): Promise<{ port: number; requests: IncomingMessage[] }> {
  const requests: IncomingMessage[] = [];
  const server = createHttpServer((req, res) => {
    requests.push(req);
    handler(req, res);
  });
  servers.push(server);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("no port");
  return { port: address.port, requests };
}

describe("the connection is pinned to the vetted address", () => {
  it("dials the pinned address for a name that does not resolve at all", async () => {
    // `.invalid` is guaranteed never to resolve (RFC 2606). If this request
    // arrives, the socket used the address it was given and asked DNS nothing.
    // Without the pin this is ENOTFOUND, which is what makes it the test.
    const { port, requests } = await loopbackServer((_req, res) => {
      res.writeHead(200, { "content-type": "text/plain" });
      res.end("reached");
    });
    const res = await pinnedFetch(`http://rebind.invalid:${port}/probe`, {
      method: "GET",
      headers: { "user-agent": "pin-test" },
      signal: AbortSignal.timeout(3000),
      addresses: ["127.0.0.1"],
    });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("reached");
    // The name travels in Host even though the address did the dialling, so a
    // virtual host and a certificate still see the real name.
    expect(requests[0]?.headers.host).toBe(`rebind.invalid:${port}`);
    expect(requests[0]?.url).toBe("/probe");
  });

  it("offers the hostname as TLS SNI, so the certificate is still checked against it", async () => {
    // A pin that dialled an IP and let TLS validate against that IP would be
    // trading a rebinding hole for a certificate hole. Read the ClientHello off
    // the wire: the server name must be the hostname, not the address. The
    // handshake then fails, which is fine — the assertion is on what we sent.
    let hello = Buffer.alloc(0);
    const tcp = createTcpServer((socket: Socket) => {
      socket.once("data", (chunk: Buffer) => {
        hello = chunk;
        socket.destroy();
      });
    });
    servers.push(tcp);
    await new Promise<void>((r) => tcp.listen(0, "127.0.0.1", r));
    const address = tcp.address();
    if (address === null || typeof address === "string") throw new Error("no port");

    await pinnedFetch(`https://pinned.example:${address.port}/`, {
      method: "GET",
      headers: {},
      signal: AbortSignal.timeout(3000),
      addresses: ["127.0.0.1"],
    }).catch(() => undefined);

    expect(hello.length).toBeGreaterThan(0);
    expect(hello.includes(Buffer.from("pinned.example", "ascii"))).toBe(true);
  });

  it("fails closed on an empty address list instead of falling back to DNS", async () => {
    // The failure mode that would undo the whole thing: a lookup with nothing
    // to return quietly deferring to the resolver. `localhost` resolves here,
    // and the request must still not arrive.
    const { port, requests } = await loopbackServer((_req, res) => res.end("reached"));
    await expect(
      pinnedFetch(`http://localhost:${port}/`, {
        method: "GET",
        headers: {},
        signal: AbortSignal.timeout(2000),
        addresses: [],
      }),
    ).rejects.toThrow(/no vetted address/);
    expect(requests).toHaveLength(0);
  });

  it("hands the transport the addresses that were vetted, on every hop", async () => {
    // The wiring. Without it the transport gets a hostname and resolves it
    // itself, which is the hole.
    const seen: Array<{ url: string; addresses: string[] }> = [];
    const transport: PinnedTransport = async (url, init) => {
      seen.push({ url, addresses: init.addresses });
      return seen.length === 1
        ? new Response(null, { status: 302, headers: { location: "https://second.example/next" } })
        : new Response("{}", { status: 200 });
    };
    const out = await guardedFetch("https://first.example/mcp", {
      transport,
      resolver: async (h) => [{ address: h === "first.example" ? "93.184.216.34" : "203.0.113.9", family: 4 }],
    });
    expect(out.ok).toBe(true);
    expect(seen).toEqual([
      { url: "https://first.example/mcp", addresses: ["93.184.216.34"] },
      { url: "https://second.example/next", addresses: ["203.0.113.9"] },
    ]);
  });

  it("pins an IP-literal URL to the literal itself", async () => {
    const seen: string[][] = [];
    const transport: PinnedTransport = async (_url, init) => {
      seen.push(init.addresses);
      return new Response("{}", { status: 200 });
    };
    await guardedFetch("https://8.8.8.8/x", { transport });
    await guardedFetch("https://[2606:4700::1]/x", { transport });
    expect(seen).toEqual([["8.8.8.8"], ["2606:4700::1"]]);
  });

  it("never hands the transport an address the guard would refuse", async () => {
    // A property, not an example: whatever the resolver says, the addresses the
    // transport is told to dial are addresses isBlockedHost accepts.
    const answers = [
      ["127.0.0.1"],
      ["93.184.216.34", "10.0.0.1"],
      ["::1"],
      ["169.254.169.254"],
      ["fd00::1"],
      ["93.184.216.34"],
    ];
    for (const answer of answers) {
      let handed: string[] | null = null;
      const transport: PinnedTransport = async (_url, init) => {
        handed = init.addresses;
        return new Response("{}", { status: 200 });
      };
      await guardedFetch("https://subject.example/", {
        transport,
        resolver: async () => answer.map((address) => ({ address, family: address.includes(":") ? 6 : 4 })),
      });
      for (const a of handed ?? []) expect(isBlockedHost(a), a).toBe(false);
    }
  });
});

/**
 * The end-to-end rebinding case, which needs a name whose SYSTEM resolution is
 * loopback while the answer we vet is public. `localtest.me` is the public
 * example and needs the network; this machine's /etc/hosts happens to carry
 * equivalents. Where it does not, the case is covered by the pin tests above
 * rather than skipped silently, so the skip says which.
 */
async function nameResolvingToLoopback(): Promise<string | null> {
  for (const candidate of ["vm", "runsc", process.env["HOSTNAME"] ?? ""]) {
    if (candidate === "" || isBlockedHost(candidate)) continue;
    try {
      const answers = (await dnsLookup(candidate, { all: true })) as Array<{ address: string }>;
      if (answers.length > 0 && answers.every((a) => a.address === "127.0.0.1")) return candidate;
    } catch {
      /* not this one */
    }
  }
  return null;
}

describe("a name that resolves differently at connect time", () => {
  it("does not reach the service the second answer points at", async () => {
    const name = await nameResolvingToLoopback();
    if (name === null) {
      // Nothing on this host resolves publicly-shaped to loopback; the pin
      // itself is covered above.
      return;
    }
    const { port, requests } = await loopbackServer((_req, res) => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ internal: "a token only loopback should see" }));
    });
    // The vetting answer is public. The system answer is 127.0.0.1. Before the
    // pin this returned the body above; now it must dial the vetted address,
    // which is a documentation address that goes nowhere.
    const out = await guardedFetch(`http://${name}:${port}/`, {
      resolver: async () => [{ address: "198.51.100.9", family: 4 }],
      timeoutMs: 700,
    });
    expect(out.ok).toBe(false);
    expect(requests).toHaveLength(0);
  });
});

describe("the deadline covers the whole call, DNS included", () => {
  const stall = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

  it("gives up on a resolver that never answers", async () => {
    // The timeout was handed to fetch and to nothing else, so a nameserver that
    // simply does not reply burned the resolver's own timeout outside the
    // budget entirely. Measured before the fix: a 200 ms call taking 1.5 s.
    const started = Date.now();
    const out = await guardedFetch("https://slow.example/", {
      timeoutMs: 150,
      resolver: async () => { await stall(3000); return [{ address: "93.184.216.34", family: 4 }]; },
      transport: async () => new Response("{}", { status: 200 }),
    });
    expect(out.ok).toBe(false);
    expect(out.ok === false && out.reason).toMatch(/deadline/);
    expect(Date.now() - started).toBeLessThan(1500);
  });

  it("does not let a redirect chain multiply the stall by the hop count", async () => {
    // Four hops x a stalled lookup each was the real worst case, and it is the
    // shape a hostile operator would choose: cheap for them, unbounded for us.
    const started = Date.now();
    let hop = 0;
    const out = await guardedFetch("https://slow.example/", {
      timeoutMs: 150,
      maxRedirects: 3,
      resolver: async () => { await stall(3000); return [{ address: "93.184.216.34", family: 4 }]; },
      transport: async () => {
        hop += 1;
        return new Response(null, { status: 302, headers: { location: `https://hop${hop}.example/` } });
      },
    });
    expect(out.ok).toBe(false);
    expect(Date.now() - started).toBeLessThan(1500);
  });
});

describe("credentials stop at the origin they were issued for", () => {
  const publicResolver = async (): Promise<Array<{ address: string; family: number }>> => [
    { address: "93.184.216.34", family: 4 },
  ];

  it("drops origin-bound headers on a redirect to another host", async () => {
    // probe.ts reads mcp-session-id off the subject's own response and sends it
    // back on every later request. A subject that answers one hop and then 302s
    // to a host of its choosing was being handed that token by us.
    const seen: Array<Record<string, string>> = [];
    const transport: PinnedTransport = async (url, init) => {
      seen.push({ ...init.headers });
      return url.includes("subject.example")
        ? new Response(null, { status: 302, headers: { location: "https://collector.example/take" } })
        : new Response("{}", { status: 200 });
    };
    await guardedFetch("https://subject.example/mcp", {
      method: "POST",
      headers: {
        "mcp-session-id": "SESSION-TOKEN",
        authorization: "Bearer SECRET",
        cookie: "sid=1",
        "user-agent": "mcp-client/1.0.0",
      },
      body: "{}",
      transport,
      resolver: publicResolver,
    });
    expect(seen[0]?.["mcp-session-id"]).toBe("SESSION-TOKEN");
    expect(seen[1]).toEqual({ "user-agent": "mcp-client/1.0.0" });
  });

  it("keeps them on a same-origin redirect, which is the ordinary case", async () => {
    const seen: Array<Record<string, string>> = [];
    const transport: PinnedTransport = async (url, init) => {
      seen.push({ ...init.headers });
      return url.endsWith("/mcp")
        ? new Response(null, { status: 307, headers: { location: "/mcp/v2" } })
        : new Response("{}", { status: 200 });
    };
    await guardedFetch("https://subject.example/mcp", {
      headers: { "mcp-session-id": "SESSION-TOKEN" },
      transport,
      resolver: publicResolver,
    });
    expect(seen[1]?.["mcp-session-id"]).toBe("SESSION-TOKEN");
  });
});

describe("a redirect cannot change the scheme out from under the guard", () => {
  it.each(["file:///etc/passwd", "gopher://127.0.0.1:11211/x", "data:text/plain,hi", "blob:https://x/y"])(
    "refuses a redirect to %s",
    async (location) => {
      const transport: PinnedTransport = async (url) =>
        url.includes("start")
          ? new Response(null, { status: 302, headers: { location } })
          : new Response("reached", { status: 200 });
      const out = await guardedFetch("https://start.example/", {
        transport,
        resolver: async () => [{ address: "93.184.216.34", family: 4 }],
      });
      expect(out.ok).toBe(false);
      expect(out.ok === false && out.reason).toMatch(/unsupported scheme|not a URL/);
    },
  );
});

describe("the byte cap stops the transfer, not just the reading", () => {
  it("closes the connection on a body that keeps coming", async () => {
    // A chunked response declares no length, so the content-length pre-check
    // cannot see it. What matters is that the socket shuts rather than that we
    // stop appending: the server must observe the close.
    let closed = false;
    let written = 0;
    const { port } = await loopbackServer((_req, res) => {
      res.writeHead(200, { "content-type": "application/json" });
      res.on("close", () => { closed = true; });
      const pump = (): void => {
        while (written < 64 * 1024 * 1024) {
          written += 4096;
          if (!res.write("x".repeat(4096))) {
            res.once("drain", pump);
            return;
          }
        }
        res.end();
      };
      pump();
    });
    const out = await guardedFetch(`http://cap.invalid:${port}/`, {
      maxBytes: 2048,
      timeoutMs: 5000,
      resolver: async () => [{ address: "93.184.216.34", family: 4 }],
      transport: (url, init) => pinnedFetch(url, { ...init, addresses: ["127.0.0.1"] }),
    });
    expect(out.ok).toBe(false);
    expect(out.ok === false && out.reason).toMatch(/over 2048 bytes/);
    await new Promise((r) => setTimeout(r, 100));
    expect(closed).toBe(true);
    expect(written).toBeLessThan(64 * 1024 * 1024);
  });
});
