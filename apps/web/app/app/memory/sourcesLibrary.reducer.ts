/**
 * Task 9 — sourcesLibrary.reducer.ts
 *
 * Pure state machine for the SourcesLibrary UI.
 * No React, no DOM, no server imports — all pure functions safe to test in vitest.
 *
 * State shape:
 *   { q, group, state, sort, dir, items, uploading, offset, limit, hasMore, loading }
 *
 * Actions:
 *   REQUEST      — mark a fetch in flight (loading=true)
 *   SET_QUERY    — update the search query string; resets offset, sets loading
 *   SET_FILTER   — set a group or state filter (null = no filter); resets offset, sets loading
 *   SET_SORT     — set sort column; if repeat column, toggle dir; else reset to 'desc'; resets offset, loading
 *   LOAD_MORE    — advance offset by limit for the next page
 *   UPLOAD_START — mark upload in flight
 *   UPLOAD_DONE  — prepend new item with extractionState 'pending'
 *   LOAD_OK      — load/replace or append the items array (server now filters)
 *
 * NOTE: derivedItems is preserved for backward-compat but no longer narrows
 * group/state/q — the server is the source of truth for filtering. It still
 * applies the sort client-side so that UPLOAD_DONE prepended items stay at top.
 */

import type { SourceListItem, MimeGroup } from './sourcesQuery';

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

export interface SourcesLibraryState {
  /** Current search query (empty string = no search). */
  q: string;
  /** Active mime-group filter, or null for "all". */
  group: MimeGroup | null;
  /** Active extraction-state filter, or null for "all". */
  state: string | null;
  /** Current sort column. */
  sort: 'captured_at' | 'title' | 'byte_size' | 'mime_type';
  /** Sort direction. */
  dir: 'asc' | 'desc';
  /** Loaded items (from the last LOAD_OK). Server is source of truth for filter/sort. */
  items: SourceListItem[];
  /** Whether a file upload is currently in flight. */
  uploading: boolean;
  /** Current page offset for load-more paging. */
  offset: number;
  /** Page size used for load-more paging. */
  limit: number;
  /** Whether the server indicated there are more items beyond the current page. */
  hasMore: boolean;
  /** Whether a server fetch is currently in flight. */
  loading: boolean;
  /** Last upload error message (null = no error). Cleared on the next UPLOAD_START. */
  uploadError: string | null;
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

export type SourcesLibraryAction =
  | { type: 'REQUEST' }
  | { type: 'SET_QUERY'; q: string }
  | { type: 'SET_FILTER'; group?: MimeGroup | null; state?: string | null }
  | { type: 'SET_SORT'; sort: SourcesLibraryState['sort'] }
  | { type: 'LOAD_MORE' }
  | { type: 'UPLOAD_START' }
  | { type: 'UPLOAD_DONE'; item: SourceListItem }
  | { type: 'UPLOAD_FAILED'; message: string }
  | { type: 'LOAD_OK'; items: SourceListItem[]; append: boolean; hasMore: boolean };

// ---------------------------------------------------------------------------
// Initial state
// ---------------------------------------------------------------------------

export function initialSourcesLibraryState(): SourcesLibraryState {
  return {
    q: '',
    group: null,
    state: null,
    sort: 'captured_at',
    dir: 'desc',
    items: [],
    uploading: false,
    offset: 0,
    limit: 50,
    hasMore: false,
    loading: false,
    uploadError: null,
  };
}

// ---------------------------------------------------------------------------
// Derived list — server now handles filter/sort/search, so this is a no-op
// passthrough kept for backward compatibility. The component uses state.items
// directly; any old callers using derivedItems still get back the full list.
// ---------------------------------------------------------------------------

export function derivedItems(s: SourcesLibraryState): SourceListItem[] {
  return s.items;
}

// ---------------------------------------------------------------------------
// Reducer
// ---------------------------------------------------------------------------

export function sourcesLibraryReducer(
  state: SourcesLibraryState,
  action: SourcesLibraryAction,
): SourcesLibraryState {
  switch (action.type) {
    case 'REQUEST':
      return { ...state, loading: true };

    case 'SET_QUERY':
      return { ...state, q: action.q, offset: 0, loading: true };

    case 'SET_FILTER':
      return {
        ...state,
        group: action.group !== undefined ? action.group : state.group,
        state: action.state !== undefined ? action.state : state.state,
        offset: 0,
        loading: true,
      };

    case 'SET_SORT': {
      // Toggle dir if same column, else reset to 'desc'
      const sameCol = action.sort === state.sort;
      return {
        ...state,
        sort: action.sort,
        dir: sameCol ? (state.dir === 'asc' ? 'desc' : 'asc') : 'desc',
        offset: 0,
        loading: true,
      };
    }

    case 'LOAD_MORE':
      return { ...state, offset: state.offset + state.limit, loading: true };

    case 'UPLOAD_START':
      return { ...state, uploading: true, uploadError: null };

    case 'UPLOAD_DONE':
      return {
        ...state,
        uploading: false,
        uploadError: null,
        // Prepend the REAL persisted item, de-duped by id so a subsequent server
        // refetch that also returns this row doesn't render it twice. We keep the
        // item's own extractionState (e.g. 'unsupported' for non-extractable files)
        // rather than forcing 'pending'.
        items: [action.item, ...state.items.filter((i) => i.id !== action.item.id)],
      };

    case 'UPLOAD_FAILED':
      // No phantom item is inserted — the list reflects only what actually
      // persisted. The error message is surfaced to the user instead.
      return { ...state, uploading: false, uploadError: action.message };

    case 'LOAD_OK':
      return {
        ...state,
        loading: false,
        hasMore: action.hasMore,
        items: action.append ? [...state.items, ...action.items] : action.items,
      };

    default:
      return state;
  }
}
