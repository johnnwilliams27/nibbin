/**
 * Task 9 — SourceRow component tests.
 *
 * Uses renderToStaticMarkup (no jsdom, no testing-library) per repo convention.
 *
 * SourceRow renders one file entry in the Sources library list:
 *  type icon + title + byte size + captured date + extraction-state chip.
 *
 * What we assert:
 *  - Each extraction-state chip label renders correctly:
 *      extracted   → "Read"
 *      extracting  → "Reading…"
 *      unsupported → "Retained — not yet read"
 *      failed      → "Couldn't read"
 *      pending     → "Queued"
 *  - Title renders
 *  - Size renders when byteSize is set
 *  - Date renders when capturedAt is set
 *  - data-extraction-state attribute is present on the chip
 *  - data-source-id is on the row root
 *
 * What we do NOT assert (no jsdom):
 *  - Click interactions
 *  - Actual fetch calls
 */

import { describe, it, expect } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { SourceRow, extractionStateLabel } from './SourceRow';
import type { SourceListItem } from './sourcesQuery';

// ---------------------------------------------------------------------------
// Fixture factory
// ---------------------------------------------------------------------------

function makeItem(overrides: Partial<SourceListItem>): SourceListItem {
  return {
    id: 'test-id',
    title: 'Sample file.pdf',
    mimeGroup: 'docs',
    byteSize: 2048,
    capturedAt: '2026-06-01T10:00:00Z',
    extractionState: 'extracted',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// extractionStateLabel pure function
// ---------------------------------------------------------------------------

describe('extractionStateLabel', () => {
  it('extracted → "Read"', () => {
    expect(extractionStateLabel('extracted')).toBe('Read');
  });

  it('extracting → "Reading…"', () => {
    // Accepts the unicode ellipsis character
    const label = extractionStateLabel('extracting');
    expect(label).toBeTruthy();
    expect(label.toLowerCase()).toMatch(/reading/);
  });

  it('unsupported → "Retained — not yet read"', () => {
    const label = extractionStateLabel('unsupported');
    expect(label.toLowerCase()).toMatch(/retained/);
    expect(label.toLowerCase()).toMatch(/not yet read/);
  });

  it('failed → contains "read" (negative)', () => {
    const label = extractionStateLabel('failed');
    expect(label.toLowerCase()).toMatch(/couldn/);
  });

  it('pending → "Queued"', () => {
    expect(extractionStateLabel('pending')).toBe('Queued');
  });
});

// ---------------------------------------------------------------------------
// SourceRow — extraction-state chip rendering
// ---------------------------------------------------------------------------

describe('SourceRow — extraction state chips', () => {
  it('extracted: renders "Read" chip', () => {
    const html = renderToStaticMarkup(
      <SourceRow item={makeItem({ extractionState: 'extracted' })} />,
    );
    expect(html).toContain('Read');
    expect(html).toContain('data-extraction-state="extracted"');
  });

  it('extracting: renders "Reading" in chip text', () => {
    const html = renderToStaticMarkup(
      <SourceRow item={makeItem({ extractionState: 'extracting' })} />,
    );
    expect(html.toLowerCase()).toContain('reading');
    expect(html).toContain('data-extraction-state="extracting"');
  });

  it('unsupported: renders "Retained" and "not yet read" in chip text', () => {
    const html = renderToStaticMarkup(
      <SourceRow item={makeItem({ extractionState: 'unsupported' })} />,
    );
    expect(html.toLowerCase()).toContain('retained');
    expect(html.toLowerCase()).toContain('not yet read');
    expect(html).toContain('data-extraction-state="unsupported"');
  });

  it('failed: renders "read" (negative sense) in chip text', () => {
    const html = renderToStaticMarkup(
      <SourceRow item={makeItem({ extractionState: 'failed' })} />,
    );
    // "Couldn't read" or similar
    expect(html.toLowerCase()).toContain("couldn");
    expect(html).toContain('data-extraction-state="failed"');
  });

  it('pending: renders "Queued" chip', () => {
    const html = renderToStaticMarkup(
      <SourceRow item={makeItem({ extractionState: 'pending' })} />,
    );
    expect(html).toContain('Queued');
    expect(html).toContain('data-extraction-state="pending"');
  });
});

// ---------------------------------------------------------------------------
// SourceRow — title, size, date
// ---------------------------------------------------------------------------

describe('SourceRow — title, size, date', () => {
  it('renders the title', () => {
    const html = renderToStaticMarkup(
      <SourceRow item={makeItem({ title: 'invoice-2026.pdf' })} />,
    );
    expect(html).toContain('invoice-2026.pdf');
  });

  it('renders data-source-id on the row root', () => {
    const html = renderToStaticMarkup(
      <SourceRow item={makeItem({ id: 'abc-123' })} />,
    );
    expect(html).toContain('data-source-id="abc-123"');
  });

  it('renders a formatted byte size', () => {
    const html = renderToStaticMarkup(
      <SourceRow item={makeItem({ byteSize: 2048 })} />,
    );
    // 2048 bytes = 2.0 KB
    expect(html).toContain('KB');
  });

  it('renders no size when byteSize is null', () => {
    const html = renderToStaticMarkup(
      <SourceRow item={makeItem({ byteSize: null })} />,
    );
    expect(html).not.toContain('KB');
    expect(html).not.toContain(' B');
  });

  it('renders a <time> element with the capturedAt date', () => {
    const html = renderToStaticMarkup(
      <SourceRow item={makeItem({ capturedAt: '2026-06-01T10:00:00Z' })} />,
    );
    expect(html).toContain('<time');
    expect(html).toContain('2026-06-01T10:00:00Z');
  });

  it('renders a file icon wrapper', () => {
    const html = renderToStaticMarkup(<SourceRow item={makeItem({})} />);
    expect(html).toContain('sourceRowIcon');
  });
});

// ---------------------------------------------------------------------------
// SourceRow — mimeGroup icons
// ---------------------------------------------------------------------------

describe('SourceRow — mimeGroup icons (visual smoke)', () => {
  const cases: Array<[SourceListItem['mimeGroup'], string]> = [
    ['docs', 'sourceRowIcon'],
    ['images', 'sourceRowIcon'],
    ['sheets', 'sourceRowIcon'],
    ['slides', 'sourceRowIcon'],
    ['web', 'sourceRowIcon'],
    ['other', 'sourceRowIcon'],
  ];

  it.each(cases)('renders icon wrapper for mimeGroup=%s', (group) => {
    const html = renderToStaticMarkup(
      <SourceRow item={makeItem({ mimeGroup: group })} />,
    );
    expect(html).toContain('sourceRowIcon');
  });
});
