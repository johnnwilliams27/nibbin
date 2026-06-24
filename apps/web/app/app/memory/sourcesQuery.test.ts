/**
 * Task 8 — sourcesQuery.ts unit tests.
 *
 * Pure module — no mocks needed.
 */

import { describe, it, expect } from 'vitest';
import {
  mimeToGroup,
  parseSourcesParams,
  mapRowToSourceListItem,
  groupToMimePredicate,
} from './sourcesQuery';

// ---------------------------------------------------------------------------
// mimeToGroup
// ---------------------------------------------------------------------------

describe('mimeToGroup', () => {
  it('image/png → images', () => {
    expect(mimeToGroup('image/png', 'photo.png')).toBe('images');
  });

  it('image/jpeg → images', () => {
    expect(mimeToGroup('image/jpeg', 'photo.jpg')).toBe('images');
  });

  it('any image/* → images', () => {
    expect(mimeToGroup('image/webp', 'x.webp')).toBe('images');
  });

  it('application/pdf → docs', () => {
    expect(mimeToGroup('application/pdf', 'report.pdf')).toBe('docs');
  });

  it('text/plain → docs', () => {
    expect(mimeToGroup('text/plain', 'notes.txt')).toBe('docs');
  });

  it('docx mime → docs', () => {
    expect(
      mimeToGroup(
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'contract.docx',
      ),
    ).toBe('docs');
  });

  it('docx filename extension with null mime → docs', () => {
    expect(mimeToGroup(null, 'contract.docx')).toBe('docs');
  });

  it('.md filename extension with null mime → docs', () => {
    expect(mimeToGroup(null, 'readme.md')).toBe('docs');
  });

  it('xlsx mime → sheets', () => {
    expect(
      mimeToGroup(
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'data.xlsx',
      ),
    ).toBe('sheets');
  });

  it('text/csv → sheets', () => {
    expect(mimeToGroup('text/csv', 'export.csv')).toBe('sheets');
  });

  it('pptx mime → slides', () => {
    expect(
      mimeToGroup(
        'application/vnd.openxmlformats-officedocument.presentationml.presentation',
        'deck.pptx',
      ),
    ).toBe('slides');
  });

  it('pptx filename extension with null mime → slides', () => {
    expect(mimeToGroup(null, 'deck.pptx')).toBe('slides');
  });

  it('text/html → web', () => {
    expect(mimeToGroup('text/html', 'page.html')).toBe('web');
  });

  it('application/zip → other', () => {
    expect(mimeToGroup('application/zip', 'archive.zip')).toBe('other');
  });

  it('null mime + unknown extension → other', () => {
    expect(mimeToGroup(null, 'file.xyz')).toBe('other');
  });

  it('null mime + no extension → other', () => {
    expect(mimeToGroup(null, 'noext')).toBe('other');
  });
});

// ---------------------------------------------------------------------------
// parseSourcesParams
// ---------------------------------------------------------------------------

describe('parseSourcesParams', () => {
  function params(obj: Record<string, string>): URLSearchParams {
    return new URLSearchParams(obj);
  }

  it('returns safe defaults when no params', () => {
    const result = parseSourcesParams(new URLSearchParams());
    expect(result).toEqual({
      q: null,
      group: null,
      state: null,
      sort: 'captured_at',
      dir: 'desc',
      limit: 50,
      offset: 0,
    });
  });

  it('parses q, group, state', () => {
    const result = parseSourcesParams(params({ q: 'invoice', group: 'docs', state: 'extracted' }));
    expect(result.q).toBe('invoice');
    expect(result.group).toBe('docs');
    expect(result.state).toBe('extracted');
  });

  it('clamps limit to max 100', () => {
    expect(parseSourcesParams(params({ limit: '500' })).limit).toBe(100);
  });

  it('clamps limit to min 1', () => {
    expect(parseSourcesParams(params({ limit: '0' })).limit).toBe(1);
  });

  it('enforces offset ≥ 0', () => {
    expect(parseSourcesParams(params({ offset: '-10' })).offset).toBe(0);
  });

  it('accepts valid limit within range', () => {
    expect(parseSourcesParams(params({ limit: '75' })).limit).toBe(75);
  });

  it('rejects unknown sort column, falls back to captured_at', () => {
    expect(parseSourcesParams(params({ sort: 'hacked_column' })).sort).toBe('captured_at');
  });

  it('accepts whitelisted sort columns', () => {
    const cols = ['captured_at', 'title', 'byte_size', 'mime_type'] as const;
    for (const col of cols) {
      expect(parseSourcesParams(params({ sort: col })).sort).toBe(col);
    }
  });

  it('dir: asc is accepted', () => {
    expect(parseSourcesParams(params({ dir: 'asc' })).dir).toBe('asc');
  });

  it('dir: unknown defaults to desc', () => {
    expect(parseSourcesParams(params({ dir: 'sideways' })).dir).toBe('desc');
  });

  it('ignores invalid group, returns null', () => {
    expect(parseSourcesParams(params({ group: 'invalid_group' })).group).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// mapRowToSourceListItem
// ---------------------------------------------------------------------------

describe('mapRowToSourceListItem', () => {
  it('maps a full row correctly', () => {
    const row = {
      id: 'src-1',
      title: 'Invoice March',
      mime_type: 'application/pdf',
      byte_size: 204800,
      captured_at: '2026-06-01T12:00:00Z',
      extraction_state: 'extracted',
      storage_path: 'acct/files/invoice.pdf',
    };
    expect(mapRowToSourceListItem(row)).toEqual({
      id: 'src-1',
      title: 'Invoice March',
      mimeGroup: 'docs',
      byteSize: 204800,
      capturedAt: '2026-06-01T12:00:00Z',
      extractionState: 'extracted',
    });
  });

  it('handles null mime_type, uses filename fallback from storage_path', () => {
    const row = {
      id: 'src-2',
      title: 'Notes',
      mime_type: null,
      byte_size: null,
      captured_at: '2026-06-02T00:00:00Z',
      extraction_state: 'pending',
      storage_path: 'acct/files/notes.md',
    };
    const item = mapRowToSourceListItem(row);
    expect(item.mimeGroup).toBe('docs');
    expect(item.byteSize).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// groupToMimePredicate
// ---------------------------------------------------------------------------

describe('groupToMimePredicate', () => {
  it("'images' → kind:'in' with image/* patterns", () => {
    const p = groupToMimePredicate('images');
    expect(p.kind).toBe('in');
    expect(p.patterns.length).toBeGreaterThan(0);
    // Every pattern for images must start with 'image/'
    expect(p.patterns.every((pat) => pat.startsWith('image/'))).toBe(true);
  });

  it("'docs' → kind:'in' with pdf/plain/docx patterns", () => {
    const p = groupToMimePredicate('docs');
    expect(p.kind).toBe('in');
    expect(p.patterns).toContain('application/pdf');
    expect(p.patterns).toContain('text/plain');
  });

  it("'sheets' → kind:'in' with xlsx/csv/xls patterns", () => {
    const p = groupToMimePredicate('sheets');
    expect(p.kind).toBe('in');
    expect(p.patterns).toContain('text/csv');
  });

  it("'slides' → kind:'in' with pptx patterns", () => {
    const p = groupToMimePredicate('slides');
    expect(p.kind).toBe('in');
    expect(
      p.patterns.some((pat) =>
        pat.includes('presentationml'),
      ),
    ).toBe(true);
  });

  it("'web' → kind:'in' with text/html", () => {
    const p = groupToMimePredicate('web');
    expect(p.kind).toBe('in');
    expect(p.patterns).toContain('text/html');
  });

  it("'other' → kind:'notin' with ALL known-group patterns listed", () => {
    const p = groupToMimePredicate('other');
    expect(p.kind).toBe('notin');
    // Must include at least one pattern from each known group to exclude them
    expect(p.patterns).toContain('application/pdf');         // docs
    expect(p.patterns.some((pat) => pat.startsWith('image/'))).toBe(true); // images
    expect(p.patterns).toContain('text/csv');                // sheets
    expect(p.patterns.some((pat) => pat.includes('presentationml'))).toBe(true); // slides
    expect(p.patterns).toContain('text/html');               // web
  });

  it("'other' excludes a known docs mime (application/pdf would NOT qualify as other)", () => {
    const p = groupToMimePredicate('other');
    expect(p.kind).toBe('notin');
    // application/pdf is in the exclusion list → it is NOT 'other'
    expect(p.patterns).toContain('application/pdf');
  });

  it("'other' leaves room for unknown mimes (application/x-thing is NOT in the exclusion list)", () => {
    const p = groupToMimePredicate('other');
    expect(p.kind).toBe('notin');
    // An unknown mime should NOT appear in the notin list
    expect(p.patterns).not.toContain('application/x-thing');
  });

  it('undefined group → kind:none, empty patterns', () => {
    const p = groupToMimePredicate(undefined);
    expect(p.kind).toBe('none');
    expect(p.patterns).toHaveLength(0);
  });

  it('null group → kind:none, empty patterns', () => {
    const p = groupToMimePredicate(null);
    expect(p.kind).toBe('none');
    expect(p.patterns).toHaveLength(0);
  });
});
