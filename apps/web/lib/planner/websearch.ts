import 'server-only';

/**
 * Open-web utility (Slice 3a, design §4) — the privacy-load-bearing surface.
 *
 * Pipeline (load-bearing, mirrors connector reads):
 *  1. REDACT before egress — the query is run through the redaction battery
 *     (`applyBattery`, the same battery connector content rides) so no raw PII
 *     ever leaves the system in a search query.
 *  2. ALLOWLIST the host — only a dedicated egress-allowlisted provider host is
 *     ever contacted for web.search; web.fetch is SSRF-guarded (http(s) only,
 *     no credentials-in-URL, no private/loopback/link-local hosts).
 *  3. QUARANTINE the result — every observation the picker ever sees is wrapped
 *     with `quarantine(...)` and length-capped (it is data, never instructions).
 *
 * No provider key → web.search is not offered (Task 4 filters it) and a direct
 * call returns a clean quarantined "unavailable" observation (never throws into
 * the loop).
 */
import {
  quarantine,
  safeFetch,
  EgressDeniedError,
  isPublicIp,
  type QuarantinedContent,
  type UnsafeTestOverrides,
} from '@nibbin/connectors';
import { applyBattery } from '@nibbin/redaction';

/**
 * TEST-ONLY seam for `webFetch`. Production callers (run.ts) call
 * `webFetch(url)` with one argument; the suite passes a controlled DNS
 * `lookup`/`isPublicIp` so a rebinding hostname can be exercised without real
 * network access. Forwarded straight to `safeFetch`'s `unsafeTestOverrides`.
 */
export type WebFetchTestSeams = UnsafeTestOverrides;

/** The dedicated egress allowlist for web.search providers (hosts only). */
const SEARCH_PROVIDER_HOSTS = ['api.tavily.com', 'api.search.brave.com'];
const SEARCH_ENDPOINT = 'https://api.tavily.com/search';

/** Hard caps so a hostile/huge response can never blow the loop's budget. */
const RESULT_MAX_CHARS = 8_000;
const FETCH_MAX_BYTES = 200_000;
const TIMEOUT_MS = 8_000;

/** True when a search provider is configured (env-gated). */
export function webSearchEnabled(): boolean {
  const key = process.env.WEB_SEARCH_API_KEY;
  return typeof key === 'string' && key.trim() !== '';
}

function capText(text: string): string {
  return text.length > RESULT_MAX_CHARS ? `${text.slice(0, RESULT_MAX_CHARS)}…[truncated]` : text;
}

/** A clean, quarantined observation — the picker only ever sees quarantined web
 *  content, success or failure. Returns the wrapped string (the loop's obs). */
function obs(text: string, source: string): string {
  const q: QuarantinedContent = quarantine(capText(text), source);
  return q.wrapped;
}

/**
 * web.search — redact the query, egress to the allowlisted provider, quarantine
 * the result. Never throws; on any error returns a quarantined "unavailable".
 */
export async function webSearch(query: string): Promise<string> {
  const key = process.env.WEB_SEARCH_API_KEY;
  if (!key || key.trim() === '') {
    return obs('web search is unavailable (no provider configured)', 'web:search');
  }

  // 1. REDACT before egress — the battery placeholder, never the raw PII.
  const { text: redacted } = applyBattery(query);

  // 2. Host is fixed to the allowlisted provider endpoint (never user-derived).
  const endpointHost = new URL(SEARCH_ENDPOINT).host;
  if (!SEARCH_PROVIDER_HOSTS.includes(endpointHost)) {
    return obs('web search is unavailable (provider host not allowlisted)', 'web:search');
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(SEARCH_ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ api_key: key, query: redacted, max_results: 5 }),
      signal: controller.signal,
    });
    if (!res.ok) return obs(`web search returned ${res.status}`, 'web:search');
    const raw = (await res.text()).slice(0, FETCH_MAX_BYTES);
    return obs(raw, 'web:search');
  } catch {
    return obs('web search is unavailable (the provider could not be reached)', 'web:search');
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Reject private / loopback / link-local / metadata hosts by the LITERAL host
 * string (a cheap, fail-closed pre-filter). This is NOT the full defense — a
 * public hostname that *resolves* to a private IP (DNS rebinding) passes this
 * check; `safeFetch` below resolves every answer and pins the connection to a
 * validated public address, which is the actual rebind defense. We keep this
 * literal pre-filter so an obviously-internal target is refused before we even
 * touch DNS, and so the hostname-suffix forms (`localhost`, `.local`, etc.)
 * that `isPublicIp` doesn't classify are still rejected.
 */
function isPrivateHost(host: string): boolean {
  const h = host.toLowerCase();
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local') || h.endsWith('.internal')) return true;
  // Strip IPv6 brackets so a literal IP can be classified by the connector
  // base's audited predicate (closes octal/IPv4-mapped/etc. parser-disagreement
  // bypasses the old hand-rolled regex missed).
  const bare = h.replace(/^\[|\]$/g, '');
  const isLiteral = bare.includes(':') || /^\d+(\.\d+){3}$/.test(bare);
  if (isLiteral) return !isPublicIp(bare);
  return false;
}

/**
 * web.fetch — SSRF-guarded fetch of a public http(s) URL → quarantined,
 * length-capped result. Never throws; rejects unsafe URLs with a quarantined
 * observation.
 *
 * DNS-rebinding defense: the literal-host pre-filter alone is insufficient — a
 * public hostname can resolve to a private IP. The network call is delegated to
 * `safeFetch` (the connector base's audited egress proxy), which resolves the
 * hostname, rejects the request if ANY answer is non-public, and PINS the TCP
 * connect to the validated address so a second resolution at connect time
 * cannot rebind to an internal IP. It also re-validates on every redirect hop
 * (replacing the old `redirect:'error'`).
 */
export async function webFetch(url: string, testSeams?: WebFetchTestSeams): Promise<string> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return obs('web fetch rejected: not a valid URL', 'web:fetch');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return obs('web fetch rejected: only http(s) URLs are allowed', 'web:fetch');
  }
  if (parsed.username || parsed.password) {
    return obs('web fetch rejected: credentials in the URL are not allowed', 'web:fetch');
  }
  // Cheap literal pre-filter (fail-closed before touching DNS). Classify on
  // `hostname` (port-stripped, IPv6 still bracketed) so a `host:port` is not
  // mistaken for an IPv6 literal by the colon heuristic.
  if (isPrivateHost(parsed.hostname)) {
    return obs('web fetch rejected: that host is not reachable', 'web:fetch');
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await safeFetch(
      parsed.toString(),
      { signal: controller.signal },
      { maxResponseBytes: FETCH_MAX_BYTES, timeoutMs: TIMEOUT_MS },
      // The planner fetches arbitrary public web pages, so allow http: in
      // addition to https: (preserving web.fetch's existing scheme behavior).
      // This widens ONLY the protocol — every private-IP / rebind / pinning
      // guard in safeFetch stays in force. `testSeams` is undefined in
      // production (run.ts calls webFetch(url) with one arg); the suite uses it
      // to drive a controlled DNS resolution (rebinding) without real network.
      {
        ...(parsed.protocol === 'http:' ? { allowHttp: true } : {}),
        ...(testSeams ?? {}),
      },
    );
    if (res.status < 200 || res.status >= 300) {
      return obs(`web fetch returned ${res.status}`, `web:fetch:${parsed.host}`);
    }
    const raw = res.text().slice(0, FETCH_MAX_BYTES);
    return obs(raw, `web:fetch:${parsed.host}`);
  } catch (err) {
    // A blocked rebind / private target surfaces as EgressDeniedError — never
    // throw into the loop; return the same clean quarantined "unavailable" obs.
    if (err instanceof EgressDeniedError) {
      return obs('web fetch rejected: that host is not reachable', `web:fetch:${parsed.host}`);
    }
    return obs('web fetch is unavailable (the page could not be reached)', `web:fetch:${parsed.host}`);
  } finally {
    clearTimeout(timer);
  }
}
