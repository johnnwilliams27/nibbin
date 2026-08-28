/**
 * Registration metadata resolution (SPEC 10.2, 8). Token URIs are commonly
 * ipfs://<cid>, resolved via a configured gateway with a timeout and a size
 * cap; failures are recorded as a status, never as a negative signal about
 * the agent. Tested only against an injected fetcher; no test touches the
 * network.
 */
import type { MetadataStatus } from "@trust-index/types";

export type FetchResult = {
  ok: boolean;
  status: number;
  /** Response headers, when the fetcher exposes them. Used to reject on Content-Length before buffering. */
  headers?: { get(name: string): string | null };
  arrayBuffer: () => Promise<ArrayBuffer>;
};

/**
 * Matches the subset of the global fetch signature this module needs, so a
 * real fetch can be passed directly outside tests.
 *
 * SSRF note (SPEC 16): token URIs are attacker-controlled on chain. This
 * module blocks literal private, loopback, and link-local hosts before a
 * request is made, but it cannot re-resolve DNS across redirects. The
 * production fetcher MUST pass `redirect: "manual"` (or a redirect count of 0)
 * and re-run the same host check on any Location, and SHOULD pin the resolved
 * address, so a public hostname cannot 302-rebind into the internal network.
 */
export type Fetcher = (url: string, init: { signal: AbortSignal }) => Promise<FetchResult>;

/** Host literals that must never be fetched server-side (SSRF, SPEC 16). */
function isBlockedHost(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (h === "localhost" || h.endsWith(".localhost") || h === "" ) return true;
  // IPv6 loopback and unique-local / link-local.
  if (h === "::1" || h === "::" ) return true;
  if (h.startsWith("fc") || h.startsWith("fd") || h.startsWith("fe80:")) return true;
  // IPv4-mapped IPv6 (::ffff:a.b.c.d): fall through to the IPv4 check on the tail.
  const v4 = h.startsWith("::ffff:") ? h.slice("::ffff:".length) : h;
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(v4);
  if (m) {
    const o = m.slice(1).map(Number);
    if (o.some((n) => n > 255)) return true;
    const [a, b] = o as [number, number, number, number];
    if (a === 0 || a === 127) return true; // this-host, loopback
    if (a === 10) return true; // private
    if (a === 172 && b >= 16 && b <= 31) return true; // private
    if (a === 192 && b === 168) return true; // private
    if (a === 169 && b === 254) return true; // link-local, includes 169.254.169.254 cloud metadata
    if (a === 100 && b >= 64 && b <= 127) return true; // carrier-grade NAT
    if (a >= 224) return true; // multicast / reserved
  }
  return false;
}

export type ResolveMetadataOptions = {
  /** e.g. "https://ipfs.io/ipfs/". ipfs://<cid>[/path] becomes gatewayUrl + <cid>[/path]. */
  gatewayUrl: string;
  timeoutMs: number;
  /** Absolute cap in bytes; content at or under this is fine, over it is rejected (SPEC 10.2: 256KB). */
  maxBytes: number;
  fetcher: Fetcher;
};

/** Registration metadata fields per SPEC 8: name, description, services[], x402Support, active, supportedTrust[]. */
export type RegistrationMetadata = {
  name: string;
  description: string;
  services: Array<Record<string, unknown>>;
  x402Support: boolean;
  active: boolean;
  supportedTrust: string[];
};

export type ResolvedMetadata =
  | { status: "absent" }
  | { status: "unreachable"; reason: string }
  | { status: "malformed"; reason: string }
  | { status: "resolved"; data: RegistrationMetadata; cid: string | null };

function toGatewayUrl(tokenUri: string, gatewayUrl: string): string | null {
  if (tokenUri.startsWith("ipfs://")) {
    const rest = tokenUri.slice("ipfs://".length);
    const base = gatewayUrl.endsWith("/") ? gatewayUrl : gatewayUrl + "/";
    return base + rest;
  }
  if (tokenUri.startsWith("http://") || tokenUri.startsWith("https://")) {
    return tokenUri;
  }
  return null;
}

function extractCid(tokenUri: string): string | null {
  if (!tokenUri.startsWith("ipfs://")) return null;
  const rest = tokenUri.slice("ipfs://".length);
  return rest.split("/")[0] ?? null;
}

function isValidRegistrationMetadata(v: unknown): v is RegistrationMetadata {
  if (typeof v !== "object" || v === null) return false;
  const o = v as Record<string, unknown>;
  return (
    typeof o["name"] === "string" &&
    typeof o["description"] === "string" &&
    Array.isArray(o["services"]) &&
    typeof o["x402Support"] === "boolean" &&
    typeof o["active"] === "boolean" &&
    Array.isArray(o["supportedTrust"]) &&
    (o["supportedTrust"] as unknown[]).every((t) => typeof t === "string")
  );
}

/**
 * Resolve one agent's registration metadata. Never throws: every failure
 * mode maps to a MetadataStatus, matching the AgentSnapshot contract, which
 * treats `unreachable` as coverage information, not a negative signal.
 */
export async function resolveMetadata(
  tokenUri: string | null,
  opts: ResolveMetadataOptions,
): Promise<ResolvedMetadata> {
  if (tokenUri === null || tokenUri.trim() === "") {
    return { status: "absent" };
  }

  const url = toGatewayUrl(tokenUri, opts.gatewayUrl);
  if (url === null) {
    return { status: "malformed", reason: `unsupported token URI scheme: ${JSON.stringify(tokenUri)}` };
  }

  // SSRF guard: reject a resolved URL that is not http(s) or points at a
  // private, loopback, or link-local host before any request is made.
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(url);
  } catch {
    return { status: "malformed", reason: `not a valid URL: ${JSON.stringify(url)}` };
  }
  if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
    return { status: "malformed", reason: `blocked URL scheme: ${parsedUrl.protocol}` };
  }
  if (isBlockedHost(parsedUrl.hostname)) {
    return { status: "unreachable", reason: `blocked host (private, loopback, or link-local): ${parsedUrl.hostname}` };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs);
  let res: FetchResult;
  try {
    res = await opts.fetcher(url, { signal: controller.signal });
  } catch (err) {
    return { status: "unreachable", reason: err instanceof Error ? err.message : String(err) };
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    return { status: "unreachable", reason: `HTTP ${res.status}` };
  }

  // Reject on a declared Content-Length before buffering, so a hostile host
  // cannot make us allocate a huge body. The post-buffer check below still
  // guards a missing or lying Content-Length; a production fetcher should also
  // cap the stream itself, since a chunked response can exceed the cap with no
  // Content-Length header.
  const declaredLength = res.headers?.get("content-length");
  if (declaredLength !== null && declaredLength !== undefined) {
    const n = Number(declaredLength);
    if (Number.isFinite(n) && n > opts.maxBytes) {
      return { status: "malformed", reason: `Content-Length ${n} exceeds ${opts.maxBytes} byte cap` };
    }
  }

  const buf = await res.arrayBuffer();
  if (buf.byteLength > opts.maxBytes) {
    return { status: "malformed", reason: `exceeds ${opts.maxBytes} byte cap (${buf.byteLength} bytes)` };
  }

  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(buf);
  } catch {
    return { status: "malformed", reason: "not valid UTF-8" };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { status: "malformed", reason: "not valid JSON" };
  }

  if (!isValidRegistrationMetadata(parsed)) {
    return { status: "malformed", reason: "does not match the SPEC 8 registration file schema" };
  }

  return { status: "resolved", data: parsed, cid: extractCid(tokenUri) };
}

/** Narrow a ResolvedMetadata down to the MetadataStatus stored on the agents row. */
export function metadataStatusOf(r: ResolvedMetadata): MetadataStatus {
  return r.status;
}
