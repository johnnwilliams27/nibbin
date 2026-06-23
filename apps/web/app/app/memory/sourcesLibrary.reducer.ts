/**
 * Task 9 — sourcesLibrary.reducer.ts
 *
 * Pure state machine for the SourcesLibrary UI.
 * No React, no DOM, no server imports — all pure functions safe to test in vitest.
 *
 * State shape:
 *   { q, group, state, sort, dir, items, uploading }
 *
 * Actions:
 *   SET_QUERY   — update the search query string
 *   SET_FILTER  — set a group or state filter (null = no filter)
 *   SET_SORT    — set sort column; if repeat column, toggle dir; else reset to 'desc'
 *   UPLOAD_START — mark upload in flight
 *   UPLOAD_DONE  — prepend new item with extractionState 'pending'
 *   LOAD_OK      — load/replace the full items array
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
  /** Full unfiltered/unsorted items list (from the last LOAD_OK). */
  items: SourceListItem[];
  /** Whether a file upload is currently in flight. */
  uploading: boolean;
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

export type SourcesLibraryAction =
  | { type: 'SET_QUERY'; q: string }
  | { type: 'SET_FILTER'; group?: MimeGroup | null; state?: string | null }
  | { type: 'SET_SORT'; sort: SourcesLibraryState['sort'] }
  | { type: 'UPLOAD_START' }
  | { type: 'UPLOAD_DONE'; item: SourceListItem }
  | { type: 'LOAD_OK'; items: SourceListItem[] };

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
  };
}

// ---------------------------------------------------------------------------
// Derived list — applies q / group / state filters to items
// ---------------------------------------------------------------------------

export function derivedItems(s: SourcesLibraryState): SourceListItem[] {
  let result = s.items;

  // Filter by group
  if (s.group !== null) {
    result = result.filter((item) => item.mimeGroup === s.group);
  }

  // Filter by extraction state
  if (s.state !== null) {
    result = result.filter((item) => item.extractionState === s.state);
  }

  // Filter by search query (case-insensitive title match)
  if (s.q.trim() !== '') {
    const qLower = s.q.trim().toLowerCase();
    result = result.filter((item) => item.title.toLowerCase().includes(qLower));
  }

  // Sort
  result = [...result].sort((a, b) => {
    let cmp = 0;
    switch (s.sort) {
      case 'title':
        cmp = a.title.localeCompare(b.title);
        break;
      case 'byte_size':
        cmp = (a.byteSize ?? 0) - (b.byteSize ?? 0);
        break;
      case 'mime_type':
        cmp = a.mimeGroup.localeCompare(b.mimeGroup);
        break;
      case 'captured_at':
      default:
        cmp = a.capturedAt.localeCompare(b.capturedAt);
        break;
    }
    return s.dir === 'asc' ? cmp : -cmp;
  });

  return result;
}

// ---------------------------------------------------------------------------
// Reducer
// ---------------------------------------------------------------------------

export function sourcesLibraryReducer(
  state: SourcesLibraryState,
  action: SourcesLibraryAction,
): SourcesLibraryState {
  switch (action.type) {
    case 'SET_QUERY':
      return { ...state, q: action.q };

    case 'SET_FILTER':
      return {
        ...state,
        group: action.group !== undefined ? action.group : state.group,
        state: action.state !== undefined ? action.state : state.state,
      };

    case 'SET_SORT': {
      // Toggle dir if same column, else reset to 'desc'
      const sameCol = action.sort === state.sort;
      return {
        ...state,
        sort: action.sort,
        dir: sameCol ? (state.dir === 'asc' ? 'desc' : 'asc') : 'desc',
      };
    }

    case 'UPLOAD_START':
      return { ...state, uploading: true };

    case 'UPLOAD_DONE':
      return {
        ...state,
        uploading: false,
        // Prepend with extractionState forced to 'pending'
        items: [{ ...action.item, extractionState: 'pending' }, ...state.items],
      };

    case 'LOAD_OK':
      return { ...state, items: action.items };

    default:
      return state;
  }
}
