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
 * What this does NOT do: resolve DNS. A hostname that resolves to a private
 * address passes this check. Callers must therefore also follow redirects
 * manually and re-run this guard on every Location, which `guardedFetch`
 * below does, and a production deployment should additionally pin the
 * resolved address.
 */

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
  if (addr === "::" || addr === "::1") return true; // unspecified, loopback
  if (/^fe[89ab]/.test(addr)) return true; // link-local fe80::/10
  if (/^f[cd]/.test(addr)) return true; // unique-local fc00::/7
  if (addr.startsWith("64:ff9b:")) return true; // NAT64
  if (addr.startsWith("::ffff:") || (addr.startsWith("::") && addr.includes("."))) return true;
  // The claim above ("any embedded-IPv4 form is blocked outright") was not
  // true. The deprecated IPv4-COMPATIBLE form writes 169.254.169.254 as
  // ::a9fe:a9fe — no dot after normalisation, no ::ffff: prefix — and passed.
  // Anything in ::/96 other than the two well-known literals is an embedded
  // address or an unrouted oddity, and neither is worth fetching.
  if (/^(::|0:0:0:0:0:0:)/.test(addr)) return true;
  return false;
}

/** Host literals that must never be fetched server-side. */
export function isBlockedHost(hostname: string): boolean {
  const h = hostname.toLowerCase();
  if (h === "" || h === "localhost" || h.endsWith(".localhost")) return true;
  // The same three suffixes the battery's leak scan calls an "internal
  // hostname" when it finds them in somebody else's error output. Resolving one
  // of ours is how a public registry URL reaches a cluster-internal service.
  if (/\.(internal|local|intranet|lan|home\.arpa)$/.test(h) || h.endsWith(".svc.cluster.local")) return true;
  // IPv6 literals keep their brackets in a WHATWG hostname; only then apply the
  // IPv6 rules, so a DNS name like "fc2.com" is not mistaken for an fc00::/7 host.
  if (h.startsWith("[") && h.endsWith("]")) return isBlockedIPv6(h.slice(1, -1));
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

export type HttpOutcome =
  | { ok: true; status: number; headers: Headers; body: string; elapsedMs: number }
  | { ok: false; reason: string; status: number | null; elapsedMs: number };

export type GuardedFetchOptions = {
  method?: "GET" | "POST";
  headers?: Record<string, string>;
  body?: string;
  timeoutMs?: number;
  maxBytes?: number;
  maxRedirects?: number;
  /** Injected for tests. Defaults to the global fetch. */
  fetchImpl?: typeof fetch;
  /** Injected for tests and for determinism: elapsed time must not come from a wall clock in scored paths. */
  now?: () => number;
};

const DEFAULTS = {
  timeoutMs: 10_000,
  maxBytes: 1024 * 1024,
  maxRedirects: 3,
} as const;

/**
 * Fetch with the guard applied on every hop, a timeout, and a body cap.
 *
 * Redirects are followed manually because a pre-request host check is
 * worthless against a public hostname that 302s into the internal network.
 * Every Location goes back through vetUrl before it is requested.
 *
 * Failures are returned, never thrown: a collector's job is to record that
 * something did not answer, and an exception at this layer would turn one
 * broken subject into a broken run.
 */
export async function guardedFetch(raw: string, options: GuardedFetchOptions = {}): Promise<HttpOutcome> {
  const timeoutMs = options.timeoutMs ?? DEFAULTS.timeoutMs;
  const maxBytes = options.maxBytes ?? DEFAULTS.maxBytes;
  const maxRedirects = options.maxRedirects ?? DEFAULTS.maxRedirects;
  const doFetch = options.fetchImpl ?? fetch;
  const now = options.now ?? (() => Date.now());
  const started = now();
  const elapsed = (): number => now() - started;

  // One deadline for the whole call, redirects included. See the note at the
  // fetch below.
  const deadline = AbortSignal.timeout(timeoutMs);

  let current = raw;
  for (let hop = 0; hop <= maxRedirects; hop += 1) {
    const vetted = vetUrl(current);
    if (!vetted.allowed) return { ok: false, reason: vetted.reason, status: null, elapsedMs: elapsed() };
    let res: Response;
    try {
      res = await doFetch(vetted.url.toString(), {
        method: options.method ?? "GET",
        redirect: "manual",
        // ONE signal for the whole call, not one per hop. A fresh timeout
        // inside the redirect loop meant the real worst case was
        // (maxRedirects + 1) x timeoutMs — 60 seconds — before any byte cap
        // could apply.
        signal: deadline,
        ...(options.headers === undefined ? {} : { headers: options.headers }),
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
      try {
        current = new URL(location, vetted.url).toString();
      } catch {
        return { ok: false, reason: "unparseable redirect location", status: res.status, elapsedMs: elapsed() };
      }
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
          const { done, value } = await reader.read();
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
      return { ok: false, reason: `HTTP ${res.status}`, status: res.status, elapsedMs: elapsed() };
    }
    return { ok: true, status: res.status, headers: res.headers, body: text, elapsedMs: elapsed() };
  }
  return { ok: false, reason: `more than ${maxRedirects} redirects`, status: null, elapsedMs: elapsed() };
}
