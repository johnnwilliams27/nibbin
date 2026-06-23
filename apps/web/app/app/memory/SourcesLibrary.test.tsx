/**
 * Task 9 — SourcesLibrary component tests.
 *
 * Uses renderToStaticMarkup (no jsdom, no testing-library) per repo convention.
 *
 * SourcesLibrary is the full file library panel (drag-drop zone + file list +
 * search box + filter chips + sort control). Uses testMode prop to bypass the
 * useEffect fetch so static markup tests remain deterministic.
 *
 * What we assert:
 *
 *  Empty state (testMode='idle'):
 *  - Renders the drop zone
 *  - Renders "Drop files here" copy
 *  - Renders "No files yet" empty state copy
 *  - Renders search box
 *  - Renders filter chip buttons
 *  - Renders sort control buttons
 *
 *  Populated state (testMode='populated'):
 *  - Renders source row items via SourceRow
 *  - Item title appears in the list
 *  - Extraction-state chip is rendered
 *  - The "Retained — not yet read" unsupported state appears when present
 *
 *  Uploading state (testMode='uploading'):
 *  - Renders "Uploading…" copy in the drop zone
 *  - data-uploading attribute is "true" on the drop zone
 *
 *  Reference catch-all still renders below when mounted in SourcesTab:
 *  - (Tested via the SourcesTab render test below — Reference is always present)
 *
 * What we do NOT assert (no jsdom):
 *  - Click interactions (filter, sort, drag-drop)
 *  - fetch calls (mocked out via testMode)
 *  - State transitions
 */

import { describe, it, expect } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { SourcesLibrary } from './SourcesLibrary';
import { SourcesTab } from './SourcesTab';
import type { SourceListItem } from './sourcesQuery';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeItem(overrides: Partial<SourceListItem>): SourceListItem {
  return {
    id: 'item-1',
    title: 'My document.pdf',
    mimeGroup: 'docs',
    byteSize: 10240,
    capturedAt: '2026-06-10T12:00:00Z',
    extractionState: 'extracted',
    ...overrides,
  };
}

const SAMPLE_ITEMS: SourceListItem[] = [
  makeItem({ id: 'i1', title: 'Invoice Q2.pdf', extractionState: 'extracted' }),
  makeItem({ id: 'i2', title: 'Photo shoot.jpg', mimeGroup: 'images', extractionState: 'extracting' }),
  makeItem({ id: 'i3', title: 'Old contract.doc', mimeGroup: 'docs', extractionState: 'unsupported' }),
  makeItem({ id: 'i4', title: 'Budget.xlsx', mimeGroup: 'sheets', extractionState: 'pending' }),
  makeItem({ id: 'i5', title: 'Broken file.bin', mimeGroup: 'other', extractionState: 'failed' }),
];

const noop = async (_v: string): Promise<void> => {};

// ---------------------------------------------------------------------------
// Empty state
// ---------------------------------------------------------------------------

describe('SourcesLibrary — empty state (testMode=idle)', () => {
  it('renders the drop zone region', () => {
    const html = renderToStaticMarkup(<SourcesLibrary testMode="idle" />);
    expect(html).toContain('aria-label="File upload area"');
  });

  it('renders "Drop files here" copy', () => {
    const html = renderToStaticMarkup(<SourcesLibrary testMode="idle" />);
    expect(html).toContain('Drop files here');
  });

  it('renders the browse button', () => {
    const html = renderToStaticMarkup(<SourcesLibrary testMode="idle" />);
    expect(html).toContain('browse');
  });

  it('renders the "No files yet" empty state copy', () => {
    const html = renderToStaticMarkup(<SourcesLibrary testMode="idle" />);
    expect(html).toContain('No files yet');
  });

  it('renders the search input', () => {
    const html = renderToStaticMarkup(<SourcesLibrary testMode="idle" />);
    expect(html).toContain('aria-label="Search files"');
  });

  it('renders group filter chip buttons', () => {
    const html = renderToStaticMarkup(<SourcesLibrary testMode="idle" />);
    // "All" + 6 group chips
    expect(html).toContain('Filter by type');
    expect(html).toContain('Docs');
    expect(html).toContain('Images');
  });

  it('renders status filter chips', () => {
    const html = renderToStaticMarkup(<SourcesLibrary testMode="idle" />);
    expect(html).toContain('Filter by status');
    expect(html).toContain('All statuses');
  });

  it('renders sort control buttons', () => {
    const html = renderToStaticMarkup(<SourcesLibrary testMode="idle" />);
    expect(html).toContain('Sort:');
    expect(html).toContain('Date');
    expect(html).toContain('Name');
    expect(html).toContain('Size');
  });

  it('hidden file input for accessible fallback upload', () => {
    const html = renderToStaticMarkup(<SourcesLibrary testMode="idle" />);
    expect(html).toContain('aria-label="Upload files"');
    expect(html).toContain('type="file"');
  });
});

// ---------------------------------------------------------------------------
// Populated state
// ---------------------------------------------------------------------------

describe('SourcesLibrary — populated (testMode=populated)', () => {
  it('renders source rows via SourceRow', () => {
    const html = renderToStaticMarkup(
      <SourcesLibrary testMode="populated" testItems={SAMPLE_ITEMS} />,
    );
    expect(html).toContain('aria-label="Uploaded files"');
  });

  it('renders item titles', () => {
    const html = renderToStaticMarkup(
      <SourcesLibrary testMode="populated" testItems={SAMPLE_ITEMS} />,
    );
    expect(html).toContain('Invoice Q2.pdf');
    expect(html).toContain('Photo shoot.jpg');
  });

  it('renders the "Read" chip for extracted items', () => {
    const html = renderToStaticMarkup(
      <SourcesLibrary testMode="populated" testItems={SAMPLE_ITEMS} />,
    );
    expect(html).toContain('data-extraction-state="extracted"');
  });

  it('renders "Retained — not yet read" for unsupported items', () => {
    const html = renderToStaticMarkup(
      <SourcesLibrary testMode="populated" testItems={SAMPLE_ITEMS} />,
    );
    expect(html.toLowerCase()).toContain('retained');
    expect(html.toLowerCase()).toContain('not yet read');
  });

  it('renders "Queued" chip for pending items', () => {
    const html = renderToStaticMarkup(
      <SourcesLibrary testMode="populated" testItems={SAMPLE_ITEMS} />,
    );
    expect(html).toContain('Queued');
  });

  it('renders "Reading" in chip for extracting items', () => {
    const html = renderToStaticMarkup(
      <SourcesLibrary testMode="populated" testItems={SAMPLE_ITEMS} />,
    );
    expect(html.toLowerCase()).toContain('reading');
  });

  it('renders failed-state chip text for failed items', () => {
    const html = renderToStaticMarkup(
      <SourcesLibrary testMode="populated" testItems={SAMPLE_ITEMS} />,
    );
    expect(html.toLowerCase()).toContain("couldn");
  });

  it('does NOT render empty-state copy when items are present', () => {
    const html = renderToStaticMarkup(
      <SourcesLibrary testMode="populated" testItems={SAMPLE_ITEMS} />,
    );
    expect(html).not.toContain('No files yet');
  });
});

// ---------------------------------------------------------------------------
// Uploading state
// ---------------------------------------------------------------------------

describe('SourcesLibrary — uploading (testMode=uploading)', () => {
  it('renders "Uploading…" in the drop zone', () => {
    const html = renderToStaticMarkup(
      <SourcesLibrary testMode="uploading" testUploading={true} />,
    );
    // Accepts unicode or encoded ellipsis
    expect(html.toLowerCase()).toContain('uploading');
  });

  it('data-uploading attribute is "true" on the drop zone', () => {
    const html = renderToStaticMarkup(
      <SourcesLibrary testMode="uploading" testUploading={true} />,
    );
    expect(html).toContain('data-uploading="true"');
  });

  it('does NOT render "Drop files here" while uploading', () => {
    const html = renderToStaticMarkup(
      <SourcesLibrary testMode="uploading" testUploading={true} />,
    );
    expect(html).not.toContain('Drop files here');
  });
});

// ---------------------------------------------------------------------------
// Reference catch-all still renders (mount in SourcesTab)
// ---------------------------------------------------------------------------

describe('SourcesLibrary — Reference catch-all still renders below', () => {
  it('SourcesTab renders SourcesLibrary + ReferenceCatchAll', () => {
    const html = renderToStaticMarkup(
      <SourcesTab referenceValue="" onSaveReference={noop} />,
    );
    // SourcesLibrary drop zone should be present
    expect(html).toContain('Drop files here');
    // Reference catch-all section should also be present
    expect(html).toContain('Reference material');
  });

  it('SourcesTab ReferenceCatchAll label is "Reference material"', () => {
    const html = renderToStaticMarkup(
      <SourcesTab referenceValue="Some text here" onSaveReference={noop} />,
    );
    expect(html).toContain('Reference material');
  });

  it('SourcesTab evidence section is present', () => {
    const html = renderToStaticMarkup(
      <SourcesTab referenceValue="" onSaveReference={noop} />,
    );
    // Evidence section (EvidenceList) should still render
    expect(html).toContain('Everything Nibbin has read or watched');
  });
});
