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
// groupToMimeFilter — SQL predicate builder for the API route
// ---------------------------------------------------------------------------

/**
 * Returns the Supabase filter value to match rows in a given group.
 * The route applies this using `.or(...)` or `.ilike()` depending on group.
 */
export function groupToMimeFilter(group: MimeGroup): { column: string; pattern: string }[] {
  switch (group) {
    case 'images':
      return [{ column: 'mime_type', pattern: 'image/%' }];
    case 'docs':
      return [
        { column: 'mime_type', pattern: 'application/pdf' },
        { column: 'mime_type', pattern: 'text/plain' },
        { column: 'mime_type', pattern: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' },
        { column: 'mime_type', pattern: 'application/msword' },
      ];
    case 'sheets':
      return [
        { column: 'mime_type', pattern: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' },
        { column: 'mime_type', pattern: 'text/csv' },
        { column: 'mime_type', pattern: 'application/vnd.ms-excel' },
      ];
    case 'slides':
      return [
        { column: 'mime_type', pattern: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' },
        { column: 'mime_type', pattern: 'application/vnd.ms-powerpoint' },
      ];
    case 'web':
      return [{ column: 'mime_type', pattern: 'text/html' }];
    case 'other':
    default:
      return [];
  }
}
