/**
 * Listing the MCP registry.
 *
 * The registry publishes server entries with cursor pagination. Only entries
 * that declare a remote endpoint are usable here: a server distributed as an
 * npm package is real, but it is a code package and belongs to a different
 * profile, not to an availability measurement nobody can make.
 *
 * The shape is read defensively rather than trusted. The registry's response
 * is other people's data, its schema has moved before, and a collector that
 * throws on an unexpected field turns one bad row into a failed run.
 *
 * A note on counting, learned expensively: an earlier census of this registry
 * reported 90,152 servers. That was the number of VERSION rows. Distinct
 * servers were 26,906. `listServers` therefore returns latest-version entries
 * and reports both counts, so nobody quotes the wrong one again.
 */
import { guardedFetch } from "../net.js";
import type { RegistryFacts } from "./transcript.js";

export const DEFAULT_REGISTRY_BASE = "https://registry.modelcontextprotocol.io";

export type RegistryEntry = {
  facts: RegistryFacts;
  /** Remote endpoints the entry declares, in the order given. */
  remotes: Array<{ type: string; url: string }>;
  /** True when the registry marks this row as the server's current version. */
  isLatest: boolean;
};

export type ListResult = {
  entries: RegistryEntry[];
  /** Rows seen, which is versions, not servers. */
  rowCount: number;
  /** Distinct server names seen. */
  distinctServers: number;
  /** Pages fetched, and whether the listing was cut short by the page cap. */
  pages: number;
  truncated: boolean;
  /** Failures encountered while paging, recorded rather than retried into silence. */
  failures: string[];
};

function str(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

/** Parse one registry row. Returns null when the row has no usable name. */
export function parseEntry(raw: unknown): RegistryEntry | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;
  const name = str(r.name);
  if (name === null) return null;

  // Publish timestamps live under a namespaced _meta key. Read both the
  // official block and the row itself, since the registry has carried them in
  // both places.
  const meta = (typeof r._meta === "object" && r._meta !== null ? r._meta : {}) as Record<string, unknown>;
  const official = (meta["io.modelcontextprotocol.registry/official"] ?? {}) as Record<string, unknown>;
  const publishedAt =
    str(official.updated_at) ?? str(official.published_at) ?? str(r.updated_at) ?? str(r.published_at);
  const firstPublishedAt = str(official.published_at) ?? str(r.published_at);
  const isLatest = official.is_latest === undefined ? true : official.is_latest === true;

  const repo = (typeof r.repository === "object" && r.repository !== null ? r.repository : {}) as Record<string, unknown>;

  const remotes: Array<{ type: string; url: string }> = [];
  if (Array.isArray(r.remotes)) {
    for (const item of r.remotes) {
      if (typeof item !== "object" || item === null) continue;
      const m = item as Record<string, unknown>;
      const url = str(m.url);
      if (url === null) continue;
      remotes.push({ type: str(m.type) ?? "unknown", url });
    }
  }

  return {
    facts: {
      name,
      description: str(r.description),
      version: str(r.version),
      published_at: publishedAt,
      first_published_at: firstPublishedAt,
      repository_url: str(repo.url),
    },
    remotes,
    isLatest,
  };
}

export type ListOptions = {
  base?: string;
  /** Rows per page the registry is asked for. */
  pageSize?: number;
  /** Hard cap on pages, so a runaway cursor cannot page forever. Reported as `truncated`. */
  maxPages?: number;
  /** Only return entries declaring at least one remote endpoint. */
  remoteOnly?: boolean;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  /** Milliseconds between pages. This is someone else's service. */
  spacingMs?: number;
};

export async function listServers(options: ListOptions = {}): Promise<ListResult> {
  const base = options.base ?? DEFAULT_REGISTRY_BASE;
  const pageSize = options.pageSize ?? 100;
  const maxPages = options.maxPages ?? 500;
  const remoteOnly = options.remoteOnly ?? true;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const spacingMs = options.spacingMs ?? 150;

  const byName = new Map<string, RegistryEntry>();
  const seenNames = new Set<string>();
  const failures: string[] = [];
  let cursor: string | null = null;
  let rowCount = 0;
  let pages = 0;
  let truncated = false;

  for (;;) {
    if (pages >= maxPages) {
      truncated = true;
      break;
    }
    const url = new URL("/v0/servers", base);
    url.searchParams.set("limit", String(pageSize));
    if (cursor !== null) url.searchParams.set("cursor", cursor);
    if (pages > 0) await sleep(spacingMs);

    const res = await guardedFetch(url.toString(), {
      timeoutMs: options.timeoutMs ?? 15_000,
      maxBytes: 8 * 1024 * 1024,
      ...(options.fetchImpl === undefined ? {} : { fetchImpl: options.fetchImpl }),
    });
    pages += 1;
    if (!res.ok) {
      // Recorded, and paging stops. Continuing past a failed page would
      // silently drop a slice of the registry and report the remainder as the
      // whole, which is the failure mode this project has hit repeatedly.
      failures.push(`page ${pages}: ${res.reason}`);
      break;
    }
    let body: Record<string, unknown>;
    try {
      body = JSON.parse(res.body) as Record<string, unknown>;
    } catch (err) {
      failures.push(`page ${pages}: ${err instanceof Error ? err.message.slice(0, 80) : "unparseable"}`);
      break;
    }
    const rows = Array.isArray(body.servers) ? body.servers : [];
    for (const row of rows) {
      rowCount += 1;
      const entry = parseEntry(row);
      if (entry === null) continue;
      seenNames.add(entry.facts.name);
      if (remoteOnly && entry.remotes.length === 0) continue;
      // Latest wins; a non-latest row never displaces a latest one.
      const existing = byName.get(entry.facts.name);
      if (existing === undefined || (!existing.isLatest && entry.isLatest)) byName.set(entry.facts.name, entry);
    }
    const metadata = (typeof body.metadata === "object" && body.metadata !== null ? body.metadata : {}) as Record<
      string,
      unknown
    >;
    const next = str(metadata.next_cursor) ?? str(metadata.nextCursor);
    if (next === null || rows.length === 0) break;
    cursor = next;
  }

  return {
    entries: [...byName.values()].sort((a, b) => (a.facts.name < b.facts.name ? -1 : a.facts.name > b.facts.name ? 1 : 0)),
    rowCount,
    distinctServers: seenNames.size,
    pages,
    truncated,
    failures,
  };
}
