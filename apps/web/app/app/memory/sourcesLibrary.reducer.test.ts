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
  derivedItems,
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
  it('replaces items with the provided array', () => {
    const s = initialSourcesLibraryState();
    const next = sourcesLibraryReducer(s, {
      type: 'LOAD_OK',
      items: [IMG_ITEM, DOC_ITEM],
    });
    expect(next.items).toHaveLength(2);
    expect(next.items[0].id).toBe('img-1');
  });

  it('does not mutate the original state', () => {
    const s = initialSourcesLibraryState();
    sourcesLibraryReducer(s, { type: 'LOAD_OK', items: [IMG_ITEM] });
    expect(s.items).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// SET_FILTER — narrows the DERIVED list
// ---------------------------------------------------------------------------

describe('sourcesLibraryReducer — SET_FILTER', () => {
  it('SET_FILTER group=images narrows derivedItems to images only', () => {
    const s = sourcesLibraryReducer(initialSourcesLibraryState(), {
      type: 'LOAD_OK',
      items: [IMG_ITEM, DOC_ITEM, SHEET_ITEM],
    });
    const filtered = sourcesLibraryReducer(s, { type: 'SET_FILTER', group: 'images' });
    const derived = derivedItems(filtered);
    expect(derived).toHaveLength(1);
    expect(derived[0].id).toBe('img-1');
  });

  it('SET_FILTER group=null shows all items', () => {
    let s = sourcesLibraryReducer(initialSourcesLibraryState(), {
      type: 'LOAD_OK',
      items: [IMG_ITEM, DOC_ITEM],
    });
    s = sourcesLibraryReducer(s, { type: 'SET_FILTER', group: 'images' });
    s = sourcesLibraryReducer(s, { type: 'SET_FILTER', group: null });
    expect(derivedItems(s)).toHaveLength(2);
  });

  it('SET_FILTER state=pending shows only pending items', () => {
    const pendingItem = makeItem({ id: 'p-1', extractionState: 'pending', mimeGroup: 'docs' });
    let s = sourcesLibraryReducer(initialSourcesLibraryState(), {
      type: 'LOAD_OK',
      items: [DOC_ITEM, pendingItem],
    });
    s = sourcesLibraryReducer(s, { type: 'SET_FILTER', state: 'pending' });
    const derived = derivedItems(s);
    expect(derived).toHaveLength(1);
    expect(derived[0].extractionState).toBe('pending');
  });

  it('filters are combinable — group AND state', () => {
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
    });
    s = sourcesLibraryReducer(s, { type: 'SET_FILTER', group: 'docs', state: 'pending' });
    const derived = derivedItems(s);
    expect(derived).toHaveLength(1);
    expect(derived[0].id).toBe('pd-1');
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

  it('sort column affects derivedItems order', () => {
    const a = makeItem({ id: 'a', title: 'aardvark.pdf', capturedAt: '2026-01-01T00:00:00Z' });
    const b = makeItem({ id: 'b', title: 'zebra.pdf', capturedAt: '2026-06-01T00:00:00Z' });
    let s = sourcesLibraryReducer(initialSourcesLibraryState(), {
      type: 'LOAD_OK',
      items: [b, a],
    });
    // Sort by title asc
    s = sourcesLibraryReducer(s, { type: 'SET_SORT', sort: 'title' }); // desc
    s = sourcesLibraryReducer(s, { type: 'SET_SORT', sort: 'title' }); // asc
    const derived = derivedItems(s);
    expect(derived[0].id).toBe('a');
    expect(derived[1].id).toBe('b');
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
    });
    const newItem = makeItem({ id: 'new-1', mimeGroup: 'images' });
    const next = sourcesLibraryReducer(s, { type: 'UPLOAD_DONE', item: newItem });
    expect(next.items[0].id).toBe('new-1');
    expect(next.items[1].id).toBe('doc-1');
  });

  it('forces extractionState to "pending" on the prepended item', () => {
    const s = initialSourcesLibraryState();
    const newItem = makeItem({ id: 'new-1', extractionState: 'extracted' });
    const next = sourcesLibraryReducer(s, { type: 'UPLOAD_DONE', item: newItem });
    expect(next.items[0].extractionState).toBe('pending');
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

  it('SET_QUERY narrows derivedItems by title', () => {
    const invoiceItem = makeItem({ id: 'inv-1', title: 'invoice-2026.pdf' });
    const otherItem = makeItem({ id: 'oth-1', title: 'photo.jpg', mimeGroup: 'images' });
    let s = sourcesLibraryReducer(initialSourcesLibraryState(), {
      type: 'LOAD_OK',
      items: [invoiceItem, otherItem],
    });
    s = sourcesLibraryReducer(s, { type: 'SET_QUERY', q: 'invoice' });
    const derived = derivedItems(s);
    expect(derived).toHaveLength(1);
    expect(derived[0].id).toBe('inv-1');
  });

  it('empty query shows all', () => {
    let s = sourcesLibraryReducer(initialSourcesLibraryState(), {
      type: 'LOAD_OK',
      items: [DOC_ITEM, IMG_ITEM],
    });
    s = sourcesLibraryReducer(s, { type: 'SET_QUERY', q: 'nomatches' });
    s = sourcesLibraryReducer(s, { type: 'SET_QUERY', q: '' });
    expect(derivedItems(s)).toHaveLength(2);
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
