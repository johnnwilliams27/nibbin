/**
 * Task 8 — sourcesQuery.ts
 *
 * Pure helpers for the GET /api/brain/sources read API.
 * No React, no DB, no server imports — all pure functions safe to test in vitest.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type MimeGroup = 'docs' | 'images' | 'sheets' | 'slides' | 'web' | 'other';

export interface SourceListItem {
  id: string;
  title: string;
  mimeGroup: MimeGroup;
  byteSize: number | null;
  capturedAt: string;
  extractionState: string;
}

export interface SourcesParams {
  q: string | null;
  group: MimeGroup | null;
  state: string | null;
  sort: 'captured_at' | 'title' | 'byte_size' | 'mime_type';
  dir: 'asc' | 'desc';
  limit: number;
  offset: number;
}

// ---------------------------------------------------------------------------
// MIME mapping table — single source of truth for group↔mime relationships
// ---------------------------------------------------------------------------

/**
 * Exact MIME types that belong to each known group.
 * `image/` entries use a prefix wildcard (handled specially in matching logic).
 * This table drives both `mimeToGroup` and `groupToMimePredicate` so the two
 * functions can never diverge.
 */
const MIME_GROUP_MAP: Record<Exclude<MimeGroup, 'other'>, string[]> = {
  images: [
    // image/* prefix — checked via startsWith in mimeToGroup; treated as a
    // wildcard ilike pattern in groupToMimePredicate
    'image/',
  ],
  docs: [
    'application/pdf',
    'text/plain',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/msword',
  ],
  sheets: [
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'text/csv',
    'application/vnd.ms-excel',
  ],
  slides: [
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'application/vnd.ms-powerpoint',
  ],
  web: ['text/html'],
};

// ---------------------------------------------------------------------------
// mimeToGroup
// ---------------------------------------------------------------------------

const SORT_WHITELIST = new Set(['captured_at', 'title', 'byte_size', 'mime_type'] as const);

/**
 * Maps a MIME type (or filename extension) to a display group.
 * Falls back through filename extension when mime is absent or unrecognised.
 */
export function mimeToGroup(mime: string | null, filename: string): MimeGroup {
  const ext = filename.toLowerCase().split('.').pop() ?? '';

  if (mime) {
    const m = mime.toLowerCase();
    if (m.startsWith('image/')) return 'images';
    if (m === 'text/html') return 'web';
    if (m === 'application/pdf') return 'docs';
    if (m === 'text/plain') return 'docs';
    if (
      m === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
      m === 'application/msword'
    )
      return 'docs';
    if (
      m === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
      m === 'text/csv' ||
      m === 'application/vnd.ms-excel'
    )
      return 'sheets';
    if (
      m === 'application/vnd.openxmlformats-officedocument.presentationml.presentation' ||
      m === 'application/vnd.ms-powerpoint'
    )
      return 'slides';
  }

  // Fallback on extension
  if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp', 'tiff', 'ico'].includes(ext))
    return 'images';
  if (['pdf', 'docx', 'doc', 'txt', 'md', 'markdown'].includes(ext)) return 'docs';
  if (['xlsx', 'xls', 'csv'].includes(ext)) return 'sheets';
  if (['pptx', 'ppt'].includes(ext)) return 'slides';
  if (['html', 'htm'].includes(ext)) return 'web';

  return 'other';
}

// ---------------------------------------------------------------------------
// groupToMimePredicate — pure predicate descriptor for the API route
// ---------------------------------------------------------------------------

export interface MimePredicate {
  /**
   * 'in'    → the mime_type must match one of the patterns (ilike wildcards ok)
   * 'notin' → the mime_type must NOT match any of the patterns
   * 'none'  → no predicate; return all rows
   */
  kind: 'in' | 'notin' | 'none';
  /** Mime patterns (exact strings or ilike wildcards like 'image/%'). */
  patterns: string[];
}

/**
 * Returns a structured predicate descriptor for the given group.
 *
 * - Known group  → kind:'in',    patterns = that group's MIME patterns
 * - 'other'      → kind:'notin', patterns = ALL known-group MIME patterns
 *                   (so only mimes that belong to NO known group qualify)
 * - null/undefined → kind:'none', no predicate
 *
 * Derived from `MIME_GROUP_MAP` so it always stays consistent with `mimeToGroup`.
 */
export function groupToMimePredicate(group: MimeGroup | null | undefined): MimePredicate {
  if (!group) {
    return { kind: 'none', patterns: [] };
  }

  if (group === 'other') {
    // Collect every MIME pattern from all known groups to build the exclusion list.
    // image/ entries become ilike-style 'image/%' wildcards.
    const allKnownPatterns: string[] = [];
    for (const patterns of Object.values(MIME_GROUP_MAP)) {
      for (const pat of patterns) {
        // Convert prefix markers (ending with '/') to ilike-style wildcard
        allKnownPatterns.push(pat.endsWith('/') ? pat + '%' : pat);
      }
    }
    return { kind: 'notin', patterns: allKnownPatterns };
  }

  const rawPatterns = MIME_GROUP_MAP[group as Exclude<MimeGroup, 'other'>];
  if (!rawPatterns) {
    return { kind: 'none', patterns: [] };
  }

  const patterns = rawPatterns.map((pat) => (pat.endsWith('/') ? pat + '%' : pat));
  return { kind: 'in', patterns };
}

// ---------------------------------------------------------------------------
// parseSourcesParams
// ---------------------------------------------------------------------------

const VALID_GROUPS = new Set<string>(['docs', 'images', 'sheets', 'slides', 'web', 'other']);

export function parseSourcesParams(searchParams: URLSearchParams): SourcesParams {
  const q = searchParams.get('q')?.trim() || null;

  const groupRaw = searchParams.get('group');
  const group = groupRaw && VALID_GROUPS.has(groupRaw) ? (groupRaw as MimeGroup) : null;

  const state = searchParams.get('state')?.trim() || null;

  const sortRaw = searchParams.get('sort') ?? 'captured_at';
  const sort: SourcesParams['sort'] = SORT_WHITELIST.has(sortRaw as never)
    ? (sortRaw as SourcesParams['sort'])
    : 'captured_at';

  const dirRaw = searchParams.get('dir');
  const dir: 'asc' | 'desc' = dirRaw === 'asc' ? 'asc' : 'desc';

  const limitRaw = parseInt(searchParams.get('limit') ?? '50', 10);
  const limit = Math.min(Math.max(isNaN(limitRaw) ? 50 : limitRaw, 1), 100);

  const offsetRaw = parseInt(searchParams.get('offset') ?? '0', 10);
  const offset = Math.max(isNaN(offsetRaw) ? 0 : offsetRaw, 0);

  return { q, group, state, sort, dir, limit, offset };
}

// ---------------------------------------------------------------------------
// mapRowToSourceListItem
// ---------------------------------------------------------------------------

export function mapRowToSourceListItem(row: Record<string, unknown>): SourceListItem {
  const title = typeof row.title === 'string' ? row.title : '';
  const storagePath = typeof row.storage_path === 'string' ? row.storage_path : title;
  const mime = typeof row.mime_type === 'string' ? row.mime_type : null;

  return {
    id: String(row.id ?? ''),
    title,
    mimeGroup: mimeToGroup(mime, storagePath),
    byteSize: typeof row.byte_size === 'number' ? row.byte_size : null,
    capturedAt: typeof row.captured_at === 'string' ? row.captured_at : '',
    extractionState: typeof row.extraction_state === 'string' ? row.extraction_state : 'pending',
  };
}

// ---------------------------------------------------------------------------
// parseSourcesListResponse
//
// Reads the items array out of the GET /api/brain/sources response. The route
// returns `{ sources, total }` — this helper is the single place that knows the
// response key, so the client and the route can't silently drift (they did:
// the client previously read `data.items`, which is always undefined, so every
// server fetch/search/filter was ignored and only optimistic uploads showed).
// ---------------------------------------------------------------------------

export function parseSourcesListResponse(json: unknown): SourceListItem[] {
  if (!json || typeof json !== 'object') return [];
  const sources = (json as { sources?: unknown }).sources;
  return Array.isArray(sources) ? (sources as SourceListItem[]) : [];
}

