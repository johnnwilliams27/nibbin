/**
 * Network guard for collectors.
 *
 * Every collector fetches URLs that someone else chose. A registry entry's
 * endpoint, a repository's homepage, a metadata document's service URL: all of
 * it is attacker-controlled input to a request made from inside our network.
 * The chain indexer already learned this the hard way, and the registry
 * contains agents pointing at localhost and at raw private addresses.
 *
 * The block list mirrors packages/indexer/src/metadata.ts exactly and is
 * verified against it by test/net.test.ts, so the two cannot drift into one
 * being weaker than the other. It is duplicated rather than imported because
 * the indexer is a chain package and a collector for a code host has no
 * business depending on viem to make an HTTP request.
 *
 * The literal check is only half of it. A hostname is not an address, and a
 * public name that resolves to a private one — `localtest.me` points at
 * 127.0.0.1, and anyone can publish such a record — walks straight through a
 * string check. So `guardedFetch` resolves the name and vets every address it
 * gets back, on the first request and again on every redirect.
 *
 * Resolving is still only two thirds of it. We used to vet the addresses a name
 * resolved to and then hand the NAME to the HTTP client, which resolved it a
 * second time to open the socket — so a record with a short TTL could answer
 * publicly for the check and privately for the connection. That was not
 * theoretical: with an injected resolver standing in for the first answer, a
 * request to a name whose system resolution is 127.0.0.1 returned the body of a
 * loopback-only service. So the socket is now PINNED: `vetResolved` hands back
 * the addresses it vetted, and the transport connects to one of those, via a
 * `lookup` that never consults DNS. The request still carries the original
 * hostname, so `Host` and the TLS SNI are the real name and the certificate is
 * still validated against it — the pin changes which address we dial, never
 * whether we check who answered.
 *
 * What this still does not cover, stated plainly rather than implied: a
 * deployment that egresses through an HTTP proxy. The proxy resolves the name
 * itself, so the pin has to live wherever the socket is actually opened. This
 * transport talks to origins directly; a caller that must egress through a
 * proxy has to supply `fetchImpl`, and gets no pin, and owes the guarantee to
 * whatever it supplies.
 */
import { lookup as dnsLookupCb } from "node:dns";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { networkInterfaces } from "node:os";
import type { LookupFunction } from "node:net";
import { Readable } from "node:stream";
import { promisify } from "node:util";

const dnsLookup = promisify(dnsLookupCb);

/** True for an IPv4 dotted-quad that is private, loopback, link-local, or reserved. */
function isBlockedIPv4(a: number, b: number, c: number, d: number): boolean {
  if ([a, b, c, d].some((n) => n > 255)) return true;
  if (a === 0 || a === 127) return true; // this-host, loopback
  if (a === 10) return true; // private
  if (a === 172 && b >= 16 && b <= 31) return true; // private
  if (a === 192 && b === 168) return true; // private
  if (a === 169 && b === 254) return true; // link-local, includes 169.254.169.254 cloud metadata
  if (a === 100 && b >= 64 && b <= 127) return true; // carrier-grade NAT
  if (a >= 224) return true; // multicast / reserved / broadcast
  return false;
}

/**
 * True for an IPv6 literal (WHATWG-normalized, brackets already stripped) that
 * must not be fetched. Any embedded-IPv4 form is blocked outright rather than
 * pattern-matched, because new URL() renders IPv4-mapped addresses in hex
 * (::ffff:a9fe:a9fe for 169.254.169.254), which a dotted-quad check would miss.
 */
function isBlockedIPv6(addr: string): boolean {
  // A scope id is not part of the address, and `fe80::1%eth0` must be read as
  // fe80::1. Belt and braces rather than load-bearing: every rule below except
  // the two equality checks is a prefix match a scope suffix cannot hide behind,
  // so no test pins this line on its own. It is here so that the next rule
  // written as an equality is correct by default.
  const bare = addr.split("%")[0] ?? addr;
  if (bare === "::" || bare === "::1") return true; // unspecified, loopback
  if (/^fe[89ab]/.test(bare)) return true; // link-local fe80::/10
  if (/^f[cd]/.test(bare)) return true; // unique-local fc00::/7
  if (bare.startsWith("64:ff9b:")) return true; // NAT64
  // 6to4 (2002::/16) encodes an arbitrary IPv4 in the next 32 bits, private
  // ones included: 2002:7f00:1:: is 127.0.0.1 and 2002:a9fe:a9fe:: is the
  // metadata address. RFC 7526 deprecated the whole scheme, so nothing we want
  // to reach lives there.
  if (/^2002:/.test(bare)) return true;
  if (bare.startsWith("::ffff:") || (bare.startsWith("::") && bare.includes("."))) return true;
  // The claim above ("any embedded-IPv4 form is blocked outright") was not
  // true. The deprecated IPv4-COMPATIBLE form writes 169.254.169.254 as
  // ::a9fe:a9fe — no dot after normalisation, no ::ffff: prefix — and passed.
  // Anything in ::/96 other than the two well-known literals is an embedded
  // address or an unrouted oddity, and neither is worth fetching.
  if (/^(::|0:0:0:0:0:0:)/.test(bare)) return true;
  return false;
}

/**
 * A hostname reduced to the form the block list is written against.
 *
 * Lower-cased, and with the root label's trailing dot removed. `localhost.` is
 * the same host as `localhost` to every resolver on earth and to nothing in a
 * suffix check: `new URL("http://localhost./")` keeps the dot in `.hostname`,
 * so `localhost.`, `db.internal.` and `svc.svc.cluster.local.` all walked
 * straight past this list until the dot was stripped. Repeated dots too, since
 * `localhost..` normalises the same way.
 */
function normalizeHostname(hostname: string): string {
  return hostname.toLowerCase().replace(/\.+$/, "");
}

/** Host literals that must never be fetched server-side. */
export function isBlockedHost(hostname: string): boolean {
  const h = normalizeHostname(hostname);
  if (h === "" || h === "localhost" || h.endsWith(".localhost")) return true;
  // The same three suffixes the battery's leak scan calls an "internal
  // hostname" when it finds them in somebody else's error output. Resolving one
  // of ours is how a public registry URL reaches a cluster-internal service.
  if (/\.(internal|local|intranet|lan|home\.arpa)$/.test(h) || h.endsWith(".svc.cluster.local")) return true;
  // The cloud metadata names, which resolve to link-local addresses we already
  // block but are worth refusing by name so the refusal reason is legible.
  if (h === "metadata.google.internal" || h === "metadata.goog" || h === "metadata") return true;
  // IPv6 literals keep their brackets in a WHATWG hostname; only then apply the
  // IPv6 rules, so a DNS name like "fc2.com" is not mistaken for an fc00::/7 host.
  if (h.startsWith("[") && h.endsWith("]")) return isBlockedIPv6(h.slice(1, -1));
  // A bare IPv6 address, which is how a resolver hands one back.
  if (h.includes(":")) return isBlockedIPv6(h);
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(h);
  if (m) return isBlockedIPv4(Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4]));
  return false;
}

export type GuardVerdict = { allowed: true; url: URL } | { allowed: false; reason: string };

/** Parse and vet a URL before anything requests it. */
export function vetUrl(raw: string): GuardVerdict {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { allowed: false, reason: "not a URL" };
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return { allowed: false, reason: `unsupported scheme ${url.protocol}` };
  }
  if (isBlockedHost(url.hostname)) return { allowed: false, reason: "blocked host" };
  return { allowed: true, url };
}

export type ResolveVerdict =
  /** The addresses that were vetted, in the order the resolver returned them. The socket must use these and no others. */
  | { allowed: true; addresses: string[] }
  | { allowed: false; reason: string };

/**
 * Does this hostname resolve to anywhere we refuse to talk to, and if not,
 * which addresses did we clear?
 *
 * Conservative on purpose. A name resolving to several addresses is refused if
 * ANY of them is blocked: a record mixing a public address with 127.0.0.1 is
 * not a name we want to race against, and legitimate hosts do not do it.
 *
 * The addresses come back because the caller must CONNECT to them. Returning
 * only a boolean is what left the rebinding window open: the answer we vetted
 * was thrown away and the name resolved again at connect time.
 *
 * An IP literal needs no resolution — `isBlockedHost` already decided — and a
 * resolution failure is a failure to reach the subject, not a finding about it.
 */
export async function vetResolved(
  hostname: string,
  resolver: (h: string) => Promise<Array<{ address: string; family: number }>> = (h) =>
    dnsLookup(h, { all: true }) as Promise<Array<{ address: string; family: number }>>,
): Promise<ResolveVerdict> {
  // Bracketed IPv6 and dotted-quad IPv4 literals were vetted by isBlockedHost.
  // They are their own pin.
  if (/^\[.*\]$/.test(hostname)) return { allowed: true, addresses: [hostname.slice(1, -1)] };
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(hostname)) return { allowed: true, addresses: [hostname] };
  let addresses: Array<{ address: string; family: number }>;
  try {
    addresses = await resolver(hostname);
  } catch (err) {
    return { allowed: false, reason: `dns lookup failed: ${err instanceof Error ? err.message.slice(0, 80) : "unknown"}` };
  }
  if (addresses.length === 0) return { allowed: false, reason: "dns returned no addresses" };
  for (const { address } of addresses) {
    // Decided from the address itself, not from the `family` field beside it.
    // Trusting the label meant a resolver reporting "::1" as family 4 got it
    // read by the IPv4 branch, which has nothing to say about a colon and
    // returned false. The string is the fact; the label is a claim about it.
    if (isBlockedHost(address)) return { allowed: false, reason: `resolves to a blocked address (${address})` };
  }
  return { allowed: true, addresses: addresses.map((a) => a.address) };
}

export type HttpOutcome =
  | { ok: true; status: number; headers: Headers; body: string; elapsedMs: number }
  /**
   * A failure still carries what the server SAID, when it said anything.
   *
   * `headers` and `body` were dropped on every non-2xx, so a caller got the
   * string "HTTP 401" and nothing else. That threw away the two things an auth
   * classifier most needs: the `WWW-Authenticate` challenge (the scheme, the
   * realm, the RFC 9728 resource metadata pointer) and the operator's own error
   * copy, which is usually where the signup URL and the free-tier terms are
   * written. The auth triage had to re-fetch six servers by hand to read text
   * we had already received and discarded.
   *
   * Both are optional because the early failures — a blocked host, a DNS
   * refusal, a deadline, an oversized body — never got a response to read. An
   * absent `body` means "no response was read", never "the response was empty".
   */
  | { ok: false; reason: string; status: number | null; elapsedMs: number; headers?: Headers; body?: string };

/**
 * What the transport is told. `addresses` is the whole point: the vetted answer
 * travels with the request instead of being re-derived at connect time.
 */
export type PinnedInit = {
  method: string;
  headers: Record<string, string>;
  body?: string | undefined;
  signal: AbortSignal;
  /** Vetted addresses to dial. The hostname is never resolved again. */
  addresses: string[];
};

export type PinnedTransport = (url: string, init: PinnedInit) => Promise<Response>;

export type GuardedFetchOptions = {
  method?: "GET" | "POST";
  headers?: Record<string, string>;
  body?: string;
  timeoutMs?: number;
  maxBytes?: number;
  maxRedirects?: number;
  /** Injected in tests so DNS behaviour is deterministic and offline. */
  resolver?: (h: string) => Promise<Array<{ address: string; family: number }>>;
  /**
   * A whole HTTP client, injected. UNPINNED: a client of the caller's choosing
   * resolves the hostname however it likes, so supplying this trades the
   * rebinding guarantee for control. Tests use it; production should not.
   */
  fetchImpl?: typeof fetch;
  /** The pinned transport, injected in tests to observe what the pin was told. */
  transport?: PinnedTransport;
  /** Injected for tests and for determinism: elapsed time must not come from a wall clock in scored paths. */
  now?: () => number;
};

const DEFAULTS = {
  timeoutMs: 10_000,
  maxBytes: 1024 * 1024,
  maxRedirects: 3,
} as const;

/** Statuses the Response constructor refuses to attach a body to. */
const NULL_BODY_STATUS = new Set([101, 103, 204, 205, 304]);

/**
 * Headers that must not survive a redirect to another origin.
 *
 * `mcp-session-id` is the concrete one: probe.ts reads it off the subject's own
 * response and sends it back on every later request, so a subject that answers
 * one hop and then 302s to a host it chooses was handed a working session token
 * for itself by us. The rest are here because a header map is caller-supplied
 * and the next caller will not think about this.
 */
const ORIGIN_BOUND_HEADERS = new Set([
  "authorization",
  "proxy-authorization",
  "cookie",
  "mcp-session-id",
  "x-api-key",
  "api-key",
  "x-auth-token",
  "x-access-token",
]);

function stripOriginBound(headers: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) {
    if (!ORIGIN_BOUND_HEADERS.has(k.toLowerCase())) out[k] = v;
  }
  return out;
}

/**
 * Reject as soon as the deadline fires, whatever the wrapped promise is doing.
 *
 * DNS was outside the deadline entirely. `AbortSignal.timeout` was handed to
 * fetch and to nothing else, so `getaddrinfo` against a nameserver that simply
 * never answers burned the resolver's own timeout — per hop, four hops deep —
 * with a 200 ms budget. Measured: a 200 ms call that took 6.0 seconds. The
 * lookup itself cannot be cancelled, so it is abandoned rather than stopped;
 * what matters is that the caller is not still waiting on it.
 */
function withDeadline<T>(promise: Promise<T>, signal: AbortSignal, what: string): Promise<T> {
  if (signal.aborted) return Promise.reject(new Error(`${what} exceeded the deadline`));
  return new Promise<T>((resolve, reject) => {
    const onAbort = (): void => reject(new Error(`${what} exceeded the deadline`));
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener("abort", onAbort));
  });
}

/**
 * An HTTP client that connects to an address someone already vetted.
 *
 * The pin is a `lookup` that returns the vetted addresses and never asks a
 * resolver anything, so there is no second answer to differ from the first.
 * Everything else about the request is the real hostname: `Host` comes from the
 * URL, TLS SNI comes from the URL, and the certificate is checked against the
 * name the way it would be without a pin. Nothing here touches
 * `rejectUnauthorized` — a pin that had to disable certificate validation to
 * work would be trading one hole for a larger one.
 *
 * Built on node:http rather than the global fetch because the pin has to live
 * on the socket, and the global fetch does not let anyone near it without an
 * undici dispatcher this package does not have. A side effect worth naming: no
 * `accept-encoding` is sent, so bodies arrive uncompressed and the byte cap
 * counts bytes on the wire rather than bytes after a decompressor.
 *
 * Userinfo in the URL is dropped rather than turned into an Authorization
 * header. `https://user:pass@host/` redirecting to another host would otherwise
 * hand the credential over, and no subject we probe has any business sending us
 * one to begin with.
 */
/**
 * Does this machine have a routable IPv6 interface at all?
 *
 * Cached: the answer cannot change within a process, and asking per request
 * would put a syscall in the hot path of every probe.
 */
let ipv6Route: boolean | null = null;
function hasIpv6Route(): boolean {
  if (ipv6Route === null) {
    ipv6Route = Object.values(networkInterfaces()).some((addrs) =>
      (addrs ?? []).some((a) => a.family === "IPv6" && !a.internal),
    );
  }
  return ipv6Route;
}

export const pinnedFetch: PinnedTransport = (rawUrl, init) =>
  new Promise<Response>((resolve, reject) => {
    let url: URL;
    try {
      url = new URL(rawUrl);
    } catch {
      reject(new Error("not a URL"));
      return;
    }
    if (init.signal.aborted) {
      reject(new Error("aborted before the request was made"));
      return;
    }
    // THIS IS A TRANSPORT, NOT A POLICY. It dials the addresses it is handed
    // and vets nothing, because the vetting has to happen where the redirect
    // loop and the resolver live. `guardedFetch` is the only caller and does
    // it; a test holds it to that. The policy was briefly duplicated here as
    // defence in depth and then removed, because it made every fixture in the
    // test suite unreachable — loopback is exactly what a local fixture binds
    // to — and a guard whose behaviour cannot be exercised is not one.
    //
    // An empty list is still refused rather than passed through: a `lookup`
    // with nothing to return must fail closed, never fall back to DNS, which
    // is the whole point of the pin.
    const pinned = init.addresses;
    if (pinned.length === 0) {
      reject(new Error("no vetted address to connect to"));
      return;
    }

    const lookup = (
      _hostname: string,
      opts: { all?: boolean | undefined; family?: number | undefined },
      cb: (err: NodeJS.ErrnoException | null, address?: unknown, family?: number) => void,
    ): void => {
      const wanted = opts.family === 4 || opts.family === 6 ? opts.family : 0;
      const entries = pinned
        .map((address) => ({ address, family: address.includes(":") ? 6 : 4 }))
        .filter((e) => wanted === 0 || e.family === wanted)
        // DROP IPv6 ENTIRELY WHEN THIS HOST HAS NO IPv6 ROUTE.
        //
        // First attempt at this only SORTED IPv4 ahead of IPv6, on the
        // reasoning that the v6 entry could stay for environments that support
        // it. That was not enough and the same crash came back: Node dials the
        // families in PARALLEL (Happy Eyeballs), so a v6 address that is merely
        // second is still attempted, still throws EAFNOSUPPORT from inside
        // net.connect, and still arrives as an unhandled error rather than a
        // rejected promise. Ordering does not prevent an attempt; only removal
        // does.
        //
        // `hasIpv6Route` is computed once from the interface list, so this is a
        // no-op wherever IPv6 genuinely works. Vetting is unchanged — both
        // families were checked before reaching here, so this narrows a trusted
        // set and admits nothing new.
        .filter((e) => e.family === 4 || hasIpv6Route())
        .sort((a, b) => a.family - b.family);
      const first = entries[0];
      if (first === undefined) {
        const err: NodeJS.ErrnoException = new Error("no pinned address for the requested family");
        err.code = "ENOTFOUND";
        cb(err);
        return;
      }
      if (opts.all === true) {
        cb(null, entries);
        return;
      }
      cb(null, first.address, first.family);
    };

    // An explicit content-length, because node:http falls back to chunked
    // transfer encoding without one and the global fetch this replaced always
    // sent a length for a string body. A subject that answers a length-declared
    // POST and rejects a chunked one would have looked like it broke, and a
    // measurement that changed because our client changed is the exact class of
    // error this project keeps finding in its own results.
    const headers = { ...init.headers };
    if (init.body !== undefined) headers["content-length"] = String(Buffer.byteLength(init.body));

    const isHttps = url.protocol === "https:";
    const request = isHttps ? httpsRequest : httpRequest;
    const req = request({
      protocol: url.protocol,
      hostname: url.hostname.replace(/^\[|\]$/g, ""),
      ...(url.port === "" ? {} : { port: Number(url.port) }),
      path: `${url.pathname}${url.search}`,
      method: init.method,
      headers,
      lookup: lookup as unknown as LookupFunction,
      // A fresh agent per request. A pooled socket is pinned to the address it
      // was opened against, and reusing one across subjects would leak that
      // pin to a request that never vetted it.
      agent: false,
    });

    const onAbort = (): void => {
      req.destroy(new Error("the request exceeded its deadline"));
    };
    init.signal.addEventListener("abort", onAbort, { once: true });
    const done = (): void => init.signal.removeEventListener("abort", onAbort);

    req.on("error", (err) => {
      done();
      reject(err);
    });
    req.on("response", (res) => {
      const headers = new Headers();
      for (const [name, value] of Object.entries(res.headers)) {
        if (Array.isArray(value)) for (const v of value) headers.append(name, v);
        else if (value !== undefined) headers.append(name, value);
      }
      const status = res.statusCode ?? 0;
      if (status < 200 || status > 599) {
        done();
        req.destroy();
        reject(new Error(`unusable HTTP status ${status}`));
        return;
      }
      const body = NULL_BODY_STATUS.has(status)
        ? null
        : (Readable.toWeb(res) as unknown as ReadableStream<Uint8Array>);
      done();
      resolve(new Response(body, { status, headers }));
    });

    if (init.body !== undefined) req.write(init.body);
    req.end();
  });

/** Adapt an injected fetch to the transport shape. It gets no pin, by construction. */
function unpinned(fetchImpl: typeof fetch): PinnedTransport {
  return (url, init) =>
    fetchImpl(url, {
      method: init.method,
      redirect: "manual",
      signal: init.signal,
      headers: init.headers,
      ...(init.body === undefined ? {} : { body: init.body }),
    });
}

/**
 * Fetch with the guard applied on every hop, a timeout, and a body cap.
 *
 * Redirects are followed manually because a pre-request host check is
 * worthless against a public hostname that 302s into the internal network.
 * Every Location goes back through vetUrl AND back through resolution before it
 * is requested, and the address that resolution cleared is the address dialled.
 *
 * Failures are returned, never thrown: a collector's job is to record that
 * something did not answer, and an exception at this layer would turn one
 * broken subject into a broken run.
 */
export async function guardedFetch(raw: string, options: GuardedFetchOptions = {}): Promise<HttpOutcome> {
  const timeoutMs = options.timeoutMs ?? DEFAULTS.timeoutMs;
  const maxBytes = options.maxBytes ?? DEFAULTS.maxBytes;
  const maxRedirects = options.maxRedirects ?? DEFAULTS.maxRedirects;
  const transport: PinnedTransport =
    options.transport ?? (options.fetchImpl === undefined ? pinnedFetch : unpinned(options.fetchImpl));
  const now = options.now ?? (() => Date.now());
  const started = now();
  const elapsed = (): number => now() - started;

  // One deadline for the whole call: redirects, DNS, connect, and body read.
  // See withDeadline for what used to fall outside it.
  const deadline = AbortSignal.timeout(timeoutMs);

  let current = raw;
  let headers = options.headers ?? {};
  for (let hop = 0; hop <= maxRedirects; hop += 1) {
    if (deadline.aborted) {
      return { ok: false, reason: "the request exceeded its deadline", status: null, elapsedMs: elapsed() };
    }
    const vetted = vetUrl(current);
    if (!vetted.allowed) return { ok: false, reason: vetted.reason, status: null, elapsedMs: elapsed() };
    // Re-run on every hop: a redirect to a name that resolves privately is the
    // same attack with an extra step.
    let resolved: ResolveVerdict;
    try {
      resolved = await withDeadline(
        options.resolver === undefined
          ? vetResolved(vetted.url.hostname)
          : vetResolved(vetted.url.hostname, options.resolver),
        deadline,
        "dns lookup",
      );
    } catch (err) {
      const reason = err instanceof Error ? err.message.slice(0, 120) : "dns lookup failed";
      return { ok: false, reason, status: null, elapsedMs: elapsed() };
    }
    if (!resolved.allowed) return { ok: false, reason: resolved.reason, status: null, elapsedMs: elapsed() };
    let res: Response;
    try {
      res = await transport(vetted.url.toString(), {
        method: options.method ?? "GET",
        headers,
        // ONE signal for the whole call, not one per hop. A fresh timeout
        // inside the redirect loop meant the real worst case was
        // (maxRedirects + 1) x timeoutMs — 60 seconds — before any byte cap
        // could apply.
        signal: deadline,
        // The vetted answer, carried to the socket. Nothing downstream resolves
        // the name a second time.
        addresses: resolved.addresses,
        ...(options.body === undefined ? {} : { body: options.body }),
      });
    } catch (err) {
      const reason = err instanceof Error ? err.message.slice(0, 120) : "fetch failed";
      return { ok: false, reason, status: null, elapsedMs: elapsed() };
    }
    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get("location");
      if (location === null) {
        return { ok: false, reason: `redirect with no location (${res.status})`, status: res.status, elapsedMs: elapsed() };
      }
      let next: URL;
      try {
        next = new URL(location, vetted.url);
      } catch {
        return { ok: false, reason: "unparseable redirect location", status: res.status, elapsedMs: elapsed() };
      }
      // Anything origin-bound stops at the origin it was bound to.
      if (next.origin !== vetted.url.origin) headers = stripOriginBound(headers);
      current = next.toString();
      // The body of a redirect is not a body we asked for and not one we read.
      await res.body?.cancel().catch(() => {});
      continue;
    }
    // Reject on a declared oversize body before reading it.
    const declared = res.headers.get("content-length");
    if (declared !== null && Number(declared) > maxBytes) {
      return { ok: false, reason: `body over ${maxBytes} bytes`, status: res.status, elapsedMs: elapsed() };
    }
    let text: string;
    try {
      // Streamed, and aborted AT the cap.
      //
      // This was `await res.arrayBuffer()` followed by a length check, which
      // materialises the whole body before deciding it was too big — so the cap
      // bounded what we KEPT, not what we read. The content-length pre-check
      // above does not help: a chunked response declares no length, and a
      // hostile server chooses chunked.
      const body = res.body;
      if (body === null) {
        text = "";
      } else {
        const reader = body.getReader();
        const chunks: Uint8Array[] = [];
        let total = 0;
        let over = false;
        for (;;) {
          // Headers can arrive while the body stays open forever (SSE, or a
          // stalled peer). Socket abort alone does not settle every reader.
          const { done, value } = await withDeadline(reader.read(), deadline, "body read")
            .catch((err: unknown) => { void reader.cancel().catch(() => {}); throw err; });
          if (done) break;
          if (value === undefined) continue;
          total += value.byteLength;
          if (total > maxBytes) {
            over = true;
            await reader.cancel().catch(() => {});
            break;
          }
          chunks.push(value);
        }
        if (over) {
          return { ok: false, reason: `body over ${maxBytes} bytes`, status: res.status, elapsedMs: elapsed() };
        }
        const joined = new Uint8Array(total);
        let at = 0;
        for (const c of chunks) {
          joined.set(c, at);
          at += c.byteLength;
        }
        text = new TextDecoder().decode(joined);
      }
    } catch (err) {
      const reason = err instanceof Error ? err.message.slice(0, 120) : "body read failed";
      return { ok: false, reason, status: res.status, elapsedMs: elapsed() };
    }
    if (!res.ok) {
      // The body was already read, above, and used to be thrown away here. See
      // HttpOutcome: a 401's own words are evidence, not noise.
      return { ok: false, reason: `HTTP ${res.status}`, status: res.status, elapsedMs: elapsed(), headers: res.headers, body: text };
    }
    return { ok: true, status: res.status, headers: res.headers, body: text, elapsedMs: elapsed() };
  }
  return { ok: false, reason: `more than ${maxRedirects} redirects`, status: null, elapsedMs: elapsed() };
}
