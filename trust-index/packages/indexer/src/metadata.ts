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
  arrayBuffer: () => Promise<ArrayBuffer>;
};

/** Matches the subset of the global fetch signature this module needs, so a real fetch can be passed directly outside tests. */
export type Fetcher = (url: string, init: { signal: AbortSignal }) => Promise<FetchResult>;

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
