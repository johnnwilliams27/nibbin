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
import { quarantine, type QuarantinedContent } from '@nibbin/connectors';
import { applyBattery } from '@nibbin/redaction';

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

/** Reject private / loopback / link-local / metadata hosts (SSRF). */
function isPrivateHost(host: string): boolean {
  const h = host.toLowerCase();
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local') || h.endsWith('.internal')) return true;
  // IPv6 loopback / unique-local
  if (h === '[::1]' || h.startsWith('[fc') || h.startsWith('[fd') || h.startsWith('[fe80')) return true;
  // IPv4 ranges
  const m = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (m) {
    const [a, b] = [Number(m[1]), Number(m[2])];
    if (a === 127 || a === 10 || a === 0) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 169 && b === 254) return true; // link-local / cloud metadata
    if (a >= 224) return true; // multicast / reserved
  }
  return false;
}

/**
 * web.fetch — SSRF-guarded fetch of a public http(s) URL → quarantined,
 * length-capped result. Never throws; rejects unsafe URLs with a quarantined
 * observation.
 */
export async function webFetch(url: string): Promise<string> {
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
  if (isPrivateHost(parsed.host) || isPrivateHost(parsed.hostname)) {
    return obs('web fetch rejected: that host is not reachable', 'web:fetch');
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(parsed.toString(), {
      redirect: 'error', // a redirect could escape the SSRF guard — refuse it
      signal: controller.signal,
    });
    if (!res.ok) return obs(`web fetch returned ${res.status}`, `web:fetch:${parsed.host}`);
    const raw = (await res.text()).slice(0, FETCH_MAX_BYTES);
    return obs(raw, `web:fetch:${parsed.host}`);
  } catch {
    return obs('web fetch is unavailable (the page could not be reached)', `web:fetch:${parsed.host}`);
  } finally {
    clearTimeout(timer);
  }
}
