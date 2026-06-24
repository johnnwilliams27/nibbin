'use client';
/**
 * Task 9 / Task 2 — SourcesLibrary.tsx
 *
 * The file library panel for the Sources tab.
 * Replaces/extends the current Sources tab body above the Reference catch-all.
 *
 * Features:
 *  - Drag-drop zone (native DnD + <input type="file"> fallback) that POSTs to
 *    POST /api/brain/documents/upload. The upload endpoint lives in P2 (not yet
 *    on this branch) — fetch is mocked in tests. This component posts files and
 *    dispatches UPLOAD_START / UPLOAD_DONE to the reducer.
 *
 *  - A file list (maps SourceRow components for each item).
 *
 *  - Search box + filter chips (by mimeGroup + by extraction state) + sort control.
 *    All state lives in the reducer (sourcesLibraryReducer); this component is a
 *    dumb renderer driven by the reducer.
 *
 *  - Refetches server-side on filter/sort/search change (Task 2):
 *    builds ?group=&state=&q=&sort=&dir=&limit=&offset= from reducer state;
 *    debounces the search input (~300ms); "Load more" dispatches LOAD_MORE.
 *
 * testMode prop:
 *  - 'idle'      — renders with no items (empty state)
 *  - 'populated' — renders with provided items
 *  - 'uploading' — renders in uploading state
 *
 * When testMode is provided, the component skips the useEffect fetch. The caller
 * passes testItems (for populated) and testUploading (for uploading).
 * testHasMore controls whether the "Load more" button renders in test mode.
 *
 * CSS: adds sourceLibrary-specific classes to memory.module.css.
 */

import React, { useReducer, useEffect, useRef, useCallback } from 'react';
import {
  sourcesLibraryReducer,
  initialSourcesLibraryState,
} from './sourcesLibrary.reducer';
import { SourceRow } from './SourceRow';
import { parseSourcesListResponse } from './sourcesQuery';
import type { SourceListItem, MimeGroup } from './sourcesQuery';
import styles from './memory.module.css';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const UPLOAD_ENDPOINT = '/api/brain/documents/upload';
const SOURCES_ENDPOINT = '/api/brain/sources';
const SEARCH_DEBOUNCE_MS = 300;

const MIME_GROUP_LABELS: Record<MimeGroup, string> = {
  docs:   'Docs',
  images: 'Images',
  sheets: 'Sheets',
  slides: 'Slides',
  web:    'Web',
  other:  'Other',
};

const STATE_FILTER_LABELS: Record<string, string> = {
  extracted:   'Read',
  extracting:  'Reading',
  pending:     'Queued',
  failed:      'Failed',
  unsupported: 'Not read',
};

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface SourcesLibraryProps {
  /**
   * Test-mode override. When set, skips the useEffect fetch.
   * 'idle'      → renders empty state
   * 'populated' → renders provided testItems
   * 'uploading' → renders uploading state
   */
  testMode?: 'idle' | 'populated' | 'uploading';
  /**
   * Items to show in testMode='populated'.
   */
  testItems?: SourceListItem[];
  /**
   * Whether to show uploading state in testMode='uploading'.
   */
  testUploading?: boolean;
  /**
   * Whether to show the "Load more" button in test mode.
   */
  testHasMore?: boolean;
}

// ---------------------------------------------------------------------------
// SourcesLibrary — main export
// ---------------------------------------------------------------------------

export function SourcesLibrary({
  testMode,
  testItems,
  testUploading,
  testHasMore,
}: SourcesLibraryProps): React.ReactElement {
  // ---------------------------------------------------------------------------
  // Reducer
  // ---------------------------------------------------------------------------

  const [state, dispatch] = useReducer(sourcesLibraryReducer, undefined, () => {
    const s = initialSourcesLibraryState();
    // In test mode, pre-populate state
    if (testMode === 'populated' && testItems) {
      return {
        ...s,
        items: testItems,
        hasMore: testHasMore ?? false,
      };
    }
    if (testMode === 'uploading') {
      return { ...s, uploading: testUploading ?? true };
    }
    if (testMode === 'idle') {
      return { ...s, hasMore: testHasMore ?? false };
    }
    return s;
  });

  // ---------------------------------------------------------------------------
  // Debounced search value — so typing doesn't spam the API
  // ---------------------------------------------------------------------------

  const searchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function handleSearchChange(e: React.ChangeEvent<HTMLInputElement>) {
    const q = e.target.value;
    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    searchDebounceRef.current = setTimeout(() => {
      dispatch({ type: 'SET_QUERY', q });
    }, SEARCH_DEBOUNCE_MS);
  }

  // ---------------------------------------------------------------------------
  // Server-side refetch effect — keyed on filter/sort/search/offset
  // ---------------------------------------------------------------------------

  useEffect(() => {
    if (testMode) return; // skip fetch in test mode
    let cancelled = false;

    const params = new URLSearchParams();
    if (state.group) params.set('group', state.group);
    if (state.state) params.set('state', state.state);
    if (state.q) params.set('q', state.q);
    params.set('sort', state.sort);
    params.set('dir', state.dir);
    params.set('limit', String(state.limit));
    params.set('offset', String(state.offset));

    const append = state.offset > 0;

    async function load() {
      try {
        const res = await fetch(`${SOURCES_ENDPOINT}?${params.toString()}`);
        if (!res.ok) {
          // Clear loading on failure
          if (!cancelled) {
            dispatch({ type: 'LOAD_OK', items: [], append, hasMore: false });
          }
          return;
        }
        // The route returns `{ sources, total }` — read via parseSourcesListResponse
        // so the client and route share one source of truth for the response key.
        const items = parseSourcesListResponse(await res.json());
        if (!cancelled) {
          const hasMore = items.length === state.limit;
          dispatch({ type: 'LOAD_OK', items, append, hasMore });
        }
      } catch {
        // Fail silently — empty list renders gracefully
        if (!cancelled) {
          dispatch({ type: 'LOAD_OK', items: [], append, hasMore: false });
        }
      }
    }

    void load();
    return () => { cancelled = true; };
  }, [testMode, state.group, state.state, state.q, state.sort, state.dir, state.offset, state.limit]);

  // ---------------------------------------------------------------------------
  // Drag-drop + file input
  // ---------------------------------------------------------------------------

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = React.useState(false);

  const uploadFiles = useCallback(async (files: FileList | File[]) => {
    const fileArr = Array.from(files);
    if (fileArr.length === 0) return;

    for (const file of fileArr) {
      dispatch({ type: 'UPLOAD_START' });
      try {
        const body = new FormData();
        body.set('file', file);
        const res = await fetch(UPLOAD_ENDPOINT, { method: 'POST', body });
        if (res.ok) {
          const data = await res.json() as { item?: SourceListItem };
          if (data.item) {
            dispatch({ type: 'UPLOAD_DONE', item: data.item });
          } else {
            // Optimistic placeholder
            const placeholder: SourceListItem = {
              id: `upload-${Date.now()}`,
              title: file.name,
              mimeGroup: 'other',
              byteSize: file.size,
              capturedAt: new Date().toISOString(),
              extractionState: 'pending',
            };
            dispatch({ type: 'UPLOAD_DONE', item: placeholder });
          }
        } else {
          // Upload failed — mark as not uploading
          dispatch({
            type: 'UPLOAD_DONE',
            item: {
              id: `upload-failed-${Date.now()}`,
              title: file.name,
              mimeGroup: 'other',
              byteSize: file.size,
              capturedAt: new Date().toISOString(),
              extractionState: 'failed',
            },
          });
        }
      } catch {
        dispatch({
          type: 'UPLOAD_DONE',
          item: {
            id: `upload-failed-${Date.now()}`,
            title: file.name,
            mimeGroup: 'other',
            byteSize: file.size,
            capturedAt: new Date().toISOString(),
            extractionState: 'failed',
          },
        });
      }
    }
  }, []);

  function handleDragOver(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragOver(true);
  }

  function handleDragLeave(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragOver(false);
  }

  function handleDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragOver(false);
    if (e.dataTransfer.files.length > 0) {
      void uploadFiles(e.dataTransfer.files);
    }
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    if (e.target.files && e.target.files.length > 0) {
      void uploadFiles(e.target.files);
      // Reset so the same file can be re-selected
      e.target.value = '';
    }
  }

  // ---------------------------------------------------------------------------
  // Display items — server is source of truth; items are already filtered/sorted
  // ---------------------------------------------------------------------------

  const displayItems = state.items;

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <div className={styles.sourcesLibrary}>
      {/* ── Drop zone ──────────────────────────────────────────────────── */}
      <div
        className={`${styles.sourcesDropZone} ${dragOver ? styles.sourcesDropZoneActive : ''}`}
        role="region"
        aria-label="File upload area"
        onDragOver={testMode ? undefined : handleDragOver}
        onDragLeave={testMode ? undefined : handleDragLeave}
        onDrop={testMode ? undefined : handleDrop}
        data-uploading={state.uploading}
      >
        {state.uploading ? (
          <p className={styles.sourcesDropZoneCopy}>Uploading…</p>
        ) : (
          <>
            <p className={styles.sourcesDropZoneCopy}>
              Drop files here, or{' '}
              <button
                type="button"
                className={styles.sourcesDropZoneBtn}
                onClick={testMode ? undefined : () => fileInputRef.current?.click()}
              >
                browse
              </button>
            </p>
            <p className={styles.sourcesDropZoneHint}>
              PDFs, Word docs, images, spreadsheets, and more
            </p>
          </>
        )}

        {/* Hidden file input — the accessible fallback */}
        <input
          ref={fileInputRef}
          type="file"
          multiple
          className={styles.sourcesFileInput}
          aria-label="Upload files"
          onChange={testMode ? undefined : handleFileChange}
          tabIndex={-1}
        />
      </div>

      {/* ── Search + filters + sort ─────────────────────────────────────── */}
      <div className={styles.sourcesControls}>
        {/* Search — debounced so typing doesn't spam the API */}
        <input
          type="search"
          className={styles.sourcesSearch}
          placeholder="Search files…"
          defaultValue={state.q}
          aria-label="Search files"
          onChange={testMode ? undefined : handleSearchChange}
        />

        {/* Group filter chips */}
        <div className={styles.sourcesFilterRow} role="group" aria-label="Filter by type">
          <button
            type="button"
            className={`${styles.sourcesFilterChip} ${state.group === null ? styles.sourcesFilterChipActive : ''}`}
            onClick={testMode ? undefined : () => dispatch({ type: 'SET_FILTER', group: null })}
          >
            All
          </button>
          {(Object.keys(MIME_GROUP_LABELS) as MimeGroup[]).map((g) => (
            <button
              key={g}
              type="button"
              className={`${styles.sourcesFilterChip} ${state.group === g ? styles.sourcesFilterChipActive : ''}`}
              onClick={testMode ? undefined : () => dispatch({ type: 'SET_FILTER', group: g })}
            >
              {MIME_GROUP_LABELS[g]}
            </button>
          ))}
        </div>

        {/* State filter chips */}
        <div className={styles.sourcesFilterRow} role="group" aria-label="Filter by status">
          <button
            type="button"
            className={`${styles.sourcesFilterChip} ${state.state === null ? styles.sourcesFilterChipActive : ''}`}
            onClick={testMode ? undefined : () => dispatch({ type: 'SET_FILTER', state: null })}
          >
            All statuses
          </button>
          {Object.entries(STATE_FILTER_LABELS).map(([stateKey, label]) => (
            <button
              key={stateKey}
              type="button"
              className={`${styles.sourcesFilterChip} ${state.state === stateKey ? styles.sourcesFilterChipActive : ''}`}
              onClick={testMode ? undefined : () => dispatch({ type: 'SET_FILTER', state: stateKey })}
            >
              {label}
            </button>
          ))}
        </div>

        {/* Sort control */}
        <div className={styles.sourcesSortRow}>
          <span className={styles.sourcesSortLabel}>Sort:</span>
          {(
            [
              ['captured_at', 'Date'],
              ['title', 'Name'],
              ['byte_size', 'Size'],
            ] as const
          ).map(([col, label]) => (
            <button
              key={col}
              type="button"
              className={`${styles.sourcesSortBtn} ${state.sort === col ? styles.sourcesSortBtnActive : ''}`}
              onClick={testMode ? undefined : () => dispatch({ type: 'SET_SORT', sort: col })}
              aria-pressed={state.sort === col}
              aria-label={`Sort by ${label}${state.sort === col ? (state.dir === 'asc' ? ', ascending' : ', descending') : ''}`}
            >
              {label}
              {state.sort === col && (
                <span aria-hidden="true" className={styles.sourcesSortDir}>
                  {state.dir === 'asc' ? ' ↑' : ' ↓'}
                </span>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* ── File list ──────────────────────────────────────────────────── */}
      {displayItems.length === 0 ? (
        <div className={styles.sourcesEmpty}>
          <p className={styles.sourcesEmptyText}>
            {state.loading
              ? 'Loading…'
              : 'No files yet. Drop some above to get started.'}
          </p>
        </div>
      ) : (
        <ul className={styles.sourcesFileList} aria-label="Uploaded files">
          {displayItems.map((item) => (
            <SourceRow key={item.id} item={item} />
          ))}
        </ul>
      )}

      {/* ── Load more ──────────────────────────────────────────────────── */}
      {state.hasMore && (
        <div className={styles.sourcesLoadMore}>
          <button
            type="button"
            className={styles.sourcesLoadMoreBtn}
            onClick={testMode ? undefined : () => dispatch({ type: 'LOAD_MORE' })}
            disabled={state.loading}
          >
            {state.loading ? 'Loading…' : 'Load more'}
          </button>
        </div>
      )}
    </div>
  );
}
