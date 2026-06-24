/**
 * Task 9 — sourcesLibrary.reducer.test.ts
 *
 * Pure unit tests for the sources library state machine.
 * No DOM, no jsdom, no React.
 *
 * Covers:
 *  - SET_FILTER('images') narrows the DERIVED list
 *  - SET_SORT toggles dir on repeat-column; resets to 'desc' on new column
 *  - UPLOAD_START sets uploading=true
 *  - UPLOAD_DONE prepends the new item with extractionState:'pending', uploading=false
 *  - LOAD_OK replaces items
 *  - SET_QUERY filters by title
 *  - Purity invariants
 */

import { describe, it, expect } from 'vitest';
import {
  sourcesLibraryReducer,
  initialSourcesLibraryState,
  type SourcesLibraryState,
} from './sourcesLibrary.reducer';
import type { SourceListItem } from './sourcesQuery';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeItem(overrides: Partial<SourceListItem>): SourceListItem {
  return {
    id: 'id-1',
    title: 'Test file',
    mimeGroup: 'docs',
    byteSize: 1024,
    capturedAt: '2026-06-01T00:00:00Z',
    extractionState: 'extracted',
    ...overrides,
  };
}

const IMG_ITEM = makeItem({ id: 'img-1', mimeGroup: 'images', title: 'photo.jpg' });
const DOC_ITEM = makeItem({ id: 'doc-1', mimeGroup: 'docs', title: 'brief.pdf' });
const SHEET_ITEM = makeItem({ id: 'sh-1', mimeGroup: 'sheets', title: 'budget.xlsx' });

// ---------------------------------------------------------------------------
// initialSourcesLibraryState
// ---------------------------------------------------------------------------

describe('sourcesLibraryReducer — initialSourcesLibraryState', () => {
  it('starts with empty items, no filter, default sort', () => {
    const s = initialSourcesLibraryState();
    expect(s.items).toHaveLength(0);
    expect(s.group).toBeNull();
    expect(s.state).toBeNull();
    expect(s.q).toBe('');
    expect(s.sort).toBe('captured_at');
    expect(s.dir).toBe('desc');
    expect(s.uploading).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// LOAD_OK
// ---------------------------------------------------------------------------

describe('sourcesLibraryReducer — LOAD_OK', () => {
  it('replaces items with the provided array (append:false)', () => {
    const s = initialSourcesLibraryState();
    const next = sourcesLibraryReducer(s, {
      type: 'LOAD_OK',
      items: [IMG_ITEM, DOC_ITEM],
      append: false,
      hasMore: false,
    });
    expect(next.items).toHaveLength(2);
    expect(next.items[0].id).toBe('img-1');
  });

  it('does not mutate the original state', () => {
    const s = initialSourcesLibraryState();
    sourcesLibraryReducer(s, { type: 'LOAD_OK', items: [IMG_ITEM], append: false, hasMore: false });
    expect(s.items).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// SET_FILTER — narrows the DERIVED list
// ---------------------------------------------------------------------------

describe('sourcesLibraryReducer — SET_FILTER', () => {
  it('SET_FILTER group=images sets state.group to "images"', () => {
    // Server now handles filtering; derivedItems is a passthrough.
    // Verify the filter state is recorded so the component can build the query string.
    const s = sourcesLibraryReducer(initialSourcesLibraryState(), {
      type: 'LOAD_OK',
      items: [IMG_ITEM, DOC_ITEM, SHEET_ITEM],
      append: false,
      hasMore: false,
    });
    const filtered = sourcesLibraryReducer(s, { type: 'SET_FILTER', group: 'images' });
    expect(filtered.group).toBe('images');
    // items are untouched — server will return the filtered page on next fetch
    expect(filtered.items).toHaveLength(3);
  });

  it('SET_FILTER group=null clears group filter', () => {
    let s = sourcesLibraryReducer(initialSourcesLibraryState(), {
      type: 'LOAD_OK',
      items: [IMG_ITEM, DOC_ITEM],
      append: false,
      hasMore: false,
    });
    s = sourcesLibraryReducer(s, { type: 'SET_FILTER', group: 'images' });
    s = sourcesLibraryReducer(s, { type: 'SET_FILTER', group: null });
    expect(s.group).toBeNull();
  });

  it('SET_FILTER state=pending sets state.state to "pending"', () => {
    const pendingItem = makeItem({ id: 'p-1', extractionState: 'pending', mimeGroup: 'docs' });
    let s = sourcesLibraryReducer(initialSourcesLibraryState(), {
      type: 'LOAD_OK',
      items: [DOC_ITEM, pendingItem],
      append: false,
      hasMore: false,
    });
    s = sourcesLibraryReducer(s, { type: 'SET_FILTER', state: 'pending' });
    expect(s.state).toBe('pending');
  });

  it('filters are combinable — SET_FILTER group AND state both set on state', () => {
    const pendingDoc = makeItem({
      id: 'pd-1',
      mimeGroup: 'docs',
      extractionState: 'pending',
    });
    const extractedImg = makeItem({
      id: 'ei-1',
      mimeGroup: 'images',
      extractionState: 'extracted',
    });
    let s = sourcesLibraryReducer(initialSourcesLibraryState(), {
      type: 'LOAD_OK',
      items: [pendingDoc, extractedImg],
      append: false,
      hasMore: false,
    });
    s = sourcesLibraryReducer(s, { type: 'SET_FILTER', group: 'docs', state: 'pending' });
    expect(s.group).toBe('docs');
    expect(s.state).toBe('pending');
  });
});

// ---------------------------------------------------------------------------
// SET_SORT — toggles dir on repeat column
// ---------------------------------------------------------------------------

describe('sourcesLibraryReducer — SET_SORT', () => {
  it('sets sort column and resets dir to desc on first set', () => {
    const s = initialSourcesLibraryState();
    const next = sourcesLibraryReducer(s, { type: 'SET_SORT', sort: 'title' });
    expect(next.sort).toBe('title');
    expect(next.dir).toBe('desc');
  });

  it('toggles dir from desc to asc on repeat column', () => {
    let s = initialSourcesLibraryState();
    s = sourcesLibraryReducer(s, { type: 'SET_SORT', sort: 'title' });
    // dir is now 'desc'
    const next = sourcesLibraryReducer(s, { type: 'SET_SORT', sort: 'title' });
    expect(next.sort).toBe('title');
    expect(next.dir).toBe('asc');
  });

  it('toggles dir from asc to desc on repeat column', () => {
    let s = initialSourcesLibraryState();
    s = sourcesLibraryReducer(s, { type: 'SET_SORT', sort: 'title' }); // desc
    s = sourcesLibraryReducer(s, { type: 'SET_SORT', sort: 'title' }); // asc
    const next = sourcesLibraryReducer(s, { type: 'SET_SORT', sort: 'title' }); // back to desc
    expect(next.dir).toBe('desc');
  });

  it('resets dir to desc when switching to a different column', () => {
    let s = initialSourcesLibraryState();
    s = sourcesLibraryReducer(s, { type: 'SET_SORT', sort: 'title' }); // desc
    s = sourcesLibraryReducer(s, { type: 'SET_SORT', sort: 'title' }); // asc
    const next = sourcesLibraryReducer(s, { type: 'SET_SORT', sort: 'byte_size' });
    expect(next.sort).toBe('byte_size');
    expect(next.dir).toBe('desc');
  });

  it('initial sort (captured_at) toggles on repeat', () => {
    const s = initialSourcesLibraryState(); // sort='captured_at', dir='desc'
    const next = sourcesLibraryReducer(s, { type: 'SET_SORT', sort: 'captured_at' });
    expect(next.dir).toBe('asc');
  });

  it('SET_SORT records the sort column on state (server applies the sort on next fetch)', () => {
    // Server now handles sort; verify state is updated correctly so the component
    // can build the correct query string on refetch.
    const a = makeItem({ id: 'a', title: 'aardvark.pdf', capturedAt: '2026-01-01T00:00:00Z' });
    const b = makeItem({ id: 'b', title: 'zebra.pdf', capturedAt: '2026-06-01T00:00:00Z' });
    let s = sourcesLibraryReducer(initialSourcesLibraryState(), {
      type: 'LOAD_OK',
      items: [b, a],
      append: false,
      hasMore: false,
    });
    // Sort by title asc — two toggles
    s = sourcesLibraryReducer(s, { type: 'SET_SORT', sort: 'title' }); // desc
    s = sourcesLibraryReducer(s, { type: 'SET_SORT', sort: 'title' }); // asc
    expect(s.sort).toBe('title');
    expect(s.dir).toBe('asc');
    // Items are still in server order (not client-sorted) — server will return sorted page
    expect(s.items).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// UPLOAD_START
// ---------------------------------------------------------------------------

describe('sourcesLibraryReducer — UPLOAD_START', () => {
  it('sets uploading to true', () => {
    const s = initialSourcesLibraryState();
    const next = sourcesLibraryReducer(s, { type: 'UPLOAD_START' });
    expect(next.uploading).toBe(true);
  });

  it('does not change items', () => {
    const s = sourcesLibraryReducer(initialSourcesLibraryState(), {
      type: 'LOAD_OK',
      items: [DOC_ITEM],
      append: false,
      hasMore: false,
    });
    const next = sourcesLibraryReducer(s, { type: 'UPLOAD_START' });
    expect(next.items).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// UPLOAD_DONE
// ---------------------------------------------------------------------------

describe('sourcesLibraryReducer — UPLOAD_DONE', () => {
  it('sets uploading to false', () => {
    let s = initialSourcesLibraryState();
    s = sourcesLibraryReducer(s, { type: 'UPLOAD_START' });
    const done = makeItem({ id: 'new-1' });
    const next = sourcesLibraryReducer(s, { type: 'UPLOAD_DONE', item: done });
    expect(next.uploading).toBe(false);
  });

  it('prepends the new item to items', () => {
    const s = sourcesLibraryReducer(initialSourcesLibraryState(), {
      type: 'LOAD_OK',
      items: [DOC_ITEM],
      append: false,
      hasMore: false,
    });
    const newItem = makeItem({ id: 'new-1', mimeGroup: 'images' });
    const next = sourcesLibraryReducer(s, { type: 'UPLOAD_DONE', item: newItem });
    expect(next.items[0].id).toBe('new-1');
    expect(next.items[1].id).toBe('doc-1');
  });

  it('keeps the item\'s own extractionState (does NOT force "pending")', () => {
    // The persisted row from the upload route already carries the correct
    // extraction state (e.g. 'unsupported' for non-extractable files). Forcing
    // 'pending' would misrepresent those, so the prepended item is used verbatim.
    const s = initialSourcesLibraryState();
    const newItem = makeItem({ id: 'new-1', extractionState: 'unsupported' });
    const next = sourcesLibraryReducer(s, { type: 'UPLOAD_DONE', item: newItem });
    expect(next.items[0].extractionState).toBe('unsupported');
  });

  it('de-dupes by id so a later server refetch does not double-render the row', () => {
    // Simulate: the row already exists in the list (from a prior server load),
    // then UPLOAD_DONE prepends the same id — it should appear exactly once.
    const existing = makeItem({ id: 'dup-1', title: 'old title' });
    const s: SourcesLibraryState = { ...initialSourcesLibraryState(), items: [existing, DOC_ITEM] };
    const fresh = makeItem({ id: 'dup-1', title: 'new title' });
    const next = sourcesLibraryReducer(s, { type: 'UPLOAD_DONE', item: fresh });
    expect(next.items.filter((i) => i.id === 'dup-1')).toHaveLength(1);
    expect(next.items[0].id).toBe('dup-1');
    expect(next.items[0].title).toBe('new title'); // the fresh copy wins, at the top
  });

  it('clears any prior uploadError on success', () => {
    const s: SourcesLibraryState = { ...initialSourcesLibraryState(), uploadError: 'old error' };
    const next = sourcesLibraryReducer(s, { type: 'UPLOAD_DONE', item: makeItem({ id: 'ok-1' }) });
    expect(next.uploadError).toBeNull();
  });

  it('does not mutate the item passed in', () => {
    const s = initialSourcesLibraryState();
    const newItem = makeItem({ id: 'new-1', extractionState: 'extracted' });
    sourcesLibraryReducer(s, { type: 'UPLOAD_DONE', item: newItem });
    // Original item should be unchanged
    expect(newItem.extractionState).toBe('extracted');
  });
});

// ---------------------------------------------------------------------------
// SET_QUERY
// ---------------------------------------------------------------------------

describe('sourcesLibraryReducer — SET_QUERY', () => {
  it('updates q', () => {
    const s = initialSourcesLibraryState();
    const next = sourcesLibraryReducer(s, { type: 'SET_QUERY', q: 'invoice' });
    expect(next.q).toBe('invoice');
  });

  it('SET_QUERY records q on state (server applies the filter on next fetch)', () => {
    // Server now handles search; verify state is updated correctly.
    const invoiceItem = makeItem({ id: 'inv-1', title: 'invoice-2026.pdf' });
    const otherItem = makeItem({ id: 'oth-1', title: 'photo.jpg', mimeGroup: 'images' });
    let s = sourcesLibraryReducer(initialSourcesLibraryState(), {
      type: 'LOAD_OK',
      items: [invoiceItem, otherItem],
      append: false,
      hasMore: false,
    });
    s = sourcesLibraryReducer(s, { type: 'SET_QUERY', q: 'invoice' });
    expect(s.q).toBe('invoice');
    // items unchanged until next LOAD_OK
    expect(s.items).toHaveLength(2);
  });

  it('empty query clears q', () => {
    let s = sourcesLibraryReducer(initialSourcesLibraryState(), {
      type: 'LOAD_OK',
      items: [DOC_ITEM, IMG_ITEM],
      append: false,
      hasMore: false,
    });
    s = sourcesLibraryReducer(s, { type: 'SET_QUERY', q: 'nomatches' });
    s = sourcesLibraryReducer(s, { type: 'SET_QUERY', q: '' });
    expect(s.q).toBe('');
  });
});

// ---------------------------------------------------------------------------
// Purity invariants
// ---------------------------------------------------------------------------

describe('sourcesLibraryReducer — purity', () => {
  it('returns a new object reference on every action', () => {
    const s = initialSourcesLibraryState();
    const next = sourcesLibraryReducer(s, { type: 'SET_QUERY', q: 'foo' });
    expect(next).not.toBe(s);
  });

  it('does not mutate items array on UPLOAD_DONE', () => {
    const items = [DOC_ITEM];
    const s: SourcesLibraryState = { ...initialSourcesLibraryState(), items };
    sourcesLibraryReducer(s, {
      type: 'UPLOAD_DONE',
      item: makeItem({ id: 'new-2' }),
    });
    expect(items).toHaveLength(1); // original unchanged
  });
});

// ---------------------------------------------------------------------------
// Task 2 — server-side refetch + load-more additions
// ---------------------------------------------------------------------------

describe('sourcesLibraryReducer — Task 2: offset / hasMore / loading / REQUEST', () => {
  it('initialState has offset=0, hasMore=false, loading=false', () => {
    const s = initialSourcesLibraryState();
    expect(s.offset).toBe(0);
    expect(s.hasMore).toBe(false);
    expect(s.loading).toBe(false);
  });

  it('REQUEST action sets loading=true', () => {
    const s = initialSourcesLibraryState();
    const next = sourcesLibraryReducer(s, { type: 'REQUEST' });
    expect(next.loading).toBe(true);
  });

  it('SET_FILTER resets offset to 0 and sets loading=true', () => {
    const s: SourcesLibraryState = {
      ...initialSourcesLibraryState(),
      offset: 50,
      loading: false,
    };
    const next = sourcesLibraryReducer(s, { type: 'SET_FILTER', group: 'images' });
    expect(next.offset).toBe(0);
    expect(next.loading).toBe(true);
  });

  it('SET_QUERY resets offset to 0 and sets loading=true', () => {
    const s: SourcesLibraryState = {
      ...initialSourcesLibraryState(),
      offset: 50,
      loading: false,
    };
    const next = sourcesLibraryReducer(s, { type: 'SET_QUERY', q: 'invoice' });
    expect(next.offset).toBe(0);
    expect(next.loading).toBe(true);
  });

  it('SET_SORT resets offset to 0 and sets loading=true', () => {
    const s: SourcesLibraryState = {
      ...initialSourcesLibraryState(),
      offset: 50,
      loading: false,
    };
    const next = sourcesLibraryReducer(s, { type: 'SET_SORT', sort: 'title' });
    expect(next.offset).toBe(0);
    expect(next.loading).toBe(true);
  });

  it('LOAD_OK with append:false REPLACES items and sets loading=false', () => {
    const s: SourcesLibraryState = {
      ...initialSourcesLibraryState(),
      items: [DOC_ITEM],
      loading: true,
    };
    const next = sourcesLibraryReducer(s, {
      type: 'LOAD_OK',
      items: [IMG_ITEM, SHEET_ITEM],
      append: false,
      hasMore: false,
    });
    expect(next.items).toHaveLength(2);
    expect(next.items[0].id).toBe('img-1');
    expect(next.loading).toBe(false);
  });

  it('LOAD_OK with append:true APPENDS items and sets loading=false', () => {
    const s: SourcesLibraryState = {
      ...initialSourcesLibraryState(),
      items: [DOC_ITEM],
      loading: true,
    };
    const next = sourcesLibraryReducer(s, {
      type: 'LOAD_OK',
      items: [IMG_ITEM, SHEET_ITEM],
      append: true,
      hasMore: false,
    });
    expect(next.items).toHaveLength(3);
    expect(next.items[0].id).toBe('doc-1'); // original first
    expect(next.items[1].id).toBe('img-1'); // appended
    expect(next.loading).toBe(false);
  });

  it('LOAD_OK sets hasMore=true when a full page returned', () => {
    const s = initialSourcesLibraryState();
    const next = sourcesLibraryReducer(s, {
      type: 'LOAD_OK',
      items: [IMG_ITEM],
      append: false,
      hasMore: true,
    });
    expect(next.hasMore).toBe(true);
  });

  it('LOAD_OK sets hasMore=false when fewer than a full page returned', () => {
    const s = initialSourcesLibraryState();
    const next = sourcesLibraryReducer(s, {
      type: 'LOAD_OK',
      items: [IMG_ITEM],
      append: false,
      hasMore: false,
    });
    expect(next.hasMore).toBe(false);
  });

  it('LOAD_MORE increases offset by limit', () => {
    const s: SourcesLibraryState = { ...initialSourcesLibraryState(), offset: 0, limit: 50 };
    const next = sourcesLibraryReducer(s, { type: 'LOAD_MORE' });
    expect(next.offset).toBe(50);
    expect(next.loading).toBe(true);
  });

  it('UPLOAD_DONE still prepends item correctly (state preserved verbatim)', () => {
    const s: SourcesLibraryState = {
      ...initialSourcesLibraryState(),
      items: [DOC_ITEM],
    };
    const newItem = makeItem({ id: 'up-1', mimeGroup: 'images', extractionState: 'extracted' });
    const next = sourcesLibraryReducer(s, { type: 'UPLOAD_DONE', item: newItem });
    expect(next.items[0].id).toBe('up-1');
    expect(next.items[0].extractionState).toBe('extracted'); // preserved, not forced
    expect(next.items[1].id).toBe('doc-1');
    expect(next.uploading).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// UPLOAD_FAILED — surfaces an error, inserts NO phantom item
// ---------------------------------------------------------------------------

describe('sourcesLibraryReducer — UPLOAD_FAILED', () => {
  it('sets uploadError and clears uploading, without adding any item', () => {
    const s: SourcesLibraryState = {
      ...initialSourcesLibraryState(),
      items: [DOC_ITEM],
      uploading: true,
    };
    const next = sourcesLibraryReducer(s, { type: 'UPLOAD_FAILED', message: 'File storage failed.' });
    expect(next.uploading).toBe(false);
    expect(next.uploadError).toBe('File storage failed.');
    // No phantom item — the list reflects only what actually persisted.
    expect(next.items).toHaveLength(1);
    expect(next.items[0].id).toBe('doc-1');
  });

  it('UPLOAD_START clears a prior uploadError', () => {
    const s: SourcesLibraryState = { ...initialSourcesLibraryState(), uploadError: 'previous error' };
    const next = sourcesLibraryReducer(s, { type: 'UPLOAD_START' });
    expect(next.uploadError).toBeNull();
    expect(next.uploading).toBe(true);
  });
});
