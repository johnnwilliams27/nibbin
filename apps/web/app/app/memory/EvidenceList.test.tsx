/**
 * Task 13 — EvidenceList component tests.
 *
 * Uses renderToStaticMarkup (no jsdom, no testing-library) per repo convention.
 *
 * EvidenceList is the gated evidence store on the Sources tab. It reads `sources` rows
 * (F1-gated via SOURCES_ENABLED env var and presence of passed-in rows) and renders
 * source cards grouped by type. Pre-F1 / when the flag is off, it renders a graceful
 * empty banner.
 *
 * Spec sources:
 *  - Plan §Task 13 (EvidenceList.test.tsx)
 *  - Plan §8.2: gated evidence list with graceful empty state
 *  - Plan §14.5: Sources-tab framing copy
 *
 * IMPORTANT (plan constraint):
 *  "The component must NOT import any F1 table type at module scope (build-safe pre-F1)."
 *  We pass row data as plain objects so the component never imports from F1 schema modules.
 *
 * What we assert:
 *
 *  Empty state (SOURCES_ENABLED=false or no rows):
 *  - Renders the graceful empty banner (§8.2 copy: "Everything Nibbin has read or watched…")
 *  - Understory background class is applied to the empty banner container
 *  - No spinner rendered
 *  - Does NOT render any source card markup
 *
 *  With evidence rows (SOURCES_ENABLED=true and rows provided):
 *  - Renders source cards (one card per row)
 *  - Type label is rendered per card
 *  - Excerpt is rendered per card
 *  - "Last seen" timestamp is rendered per card
 *
 * What we do NOT assert:
 *  - Click interactions (no jsdom)
 *  - Real Supabase data fetching (server-side, not tested here)
 */

import { describe, it, expect } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { EvidenceList } from './EvidenceList';

// ---------------------------------------------------------------------------
// Source row fixture — plain object (no F1 type import at module scope)
// ---------------------------------------------------------------------------

export interface SourceRow {
  id: string;
  kind: string;
  excerpt: string | null;
  captured_at: string | null;
}

const SAMPLE_ROWS: SourceRow[] = [
  {
    id: 'src-1',
    kind: 'connector_artifact',
    excerpt: 'Your Gmail message from January about pricing updates.',
    captured_at: '2026-06-01T10:00:00Z',
  },
  {
    id: 'src-2',
    kind: 'observation',
    excerpt: 'Field study note: client prefers morning sessions.',
    captured_at: '2026-05-15T08:30:00Z',
  },
];

// ---------------------------------------------------------------------------
// Empty state — SOURCES_ENABLED false or no rows
// ---------------------------------------------------------------------------

describe('EvidenceList — empty state (no rows / flag off)', () => {
  it('renders the graceful empty banner copy when no rows provided', () => {
    const html = renderToStaticMarkup(
      <EvidenceList rows={[]} sourcesEnabled={false} />,
    );
    // Plan §8.2: "Everything Nibbin has read or watched…"
    expect(html).toContain('Everything Nibbin has read or watched');
  });

  it('renders the graceful empty banner when rows=[] even if sourcesEnabled=true', () => {
    const html = renderToStaticMarkup(
      <EvidenceList rows={[]} sourcesEnabled={true} />,
    );
    expect(html).toContain('Everything Nibbin has read or watched');
  });

  it('renders empty banner when sourcesEnabled=false even if rows are passed', () => {
    const html = renderToStaticMarkup(
      <EvidenceList rows={SAMPLE_ROWS} sourcesEnabled={false} />,
    );
    expect(html).toContain('Everything Nibbin has read or watched');
  });

  it('applies understory background class to the empty banner container', () => {
    const html = renderToStaticMarkup(
      <EvidenceList rows={[]} sourcesEnabled={false} />,
    );
    // The container should carry an understory-background class
    expect(html).toContain('evidenceEmpty');
  });

  it('does NOT render a spinner in the empty state', () => {
    const html = renderToStaticMarkup(
      <EvidenceList rows={[]} sourcesEnabled={false} />,
    );
    expect(html).not.toContain('spinner');
    expect(html).not.toContain('loading');
  });

  it('does NOT render source card markup in the empty state', () => {
    const html = renderToStaticMarkup(
      <EvidenceList rows={[]} sourcesEnabled={false} />,
    );
    expect(html).not.toContain('evidenceCard');
  });
});

// ---------------------------------------------------------------------------
// With evidence rows (sourcesEnabled=true and rows provided)
// ---------------------------------------------------------------------------

describe('EvidenceList — with evidence rows', () => {
  it('renders source cards when sourcesEnabled=true and rows are provided', () => {
    const html = renderToStaticMarkup(
      <EvidenceList rows={SAMPLE_ROWS} sourcesEnabled={true} />,
    );
    expect(html).toContain('evidenceCard');
  });

  it('renders one card per row', () => {
    const html = renderToStaticMarkup(
      <EvidenceList rows={SAMPLE_ROWS} sourcesEnabled={true} />,
    );
    const cardCount = (html.match(/evidenceCard/g) ?? []).length;
    expect(cardCount).toBeGreaterThanOrEqual(SAMPLE_ROWS.length);
  });

  it('renders the type label for each source card', () => {
    const html = renderToStaticMarkup(
      <EvidenceList rows={SAMPLE_ROWS} sourcesEnabled={true} />,
    );
    // Kind labels mapped from kind value
    expect(html).toContain('connector_artifact');
    expect(html).toContain('observation');
  });

  it('renders the excerpt text for each source card', () => {
    const html = renderToStaticMarkup(
      <EvidenceList rows={SAMPLE_ROWS} sourcesEnabled={true} />,
    );
    expect(html).toContain('pricing updates');
    expect(html).toContain('morning sessions');
  });

  it('renders "Last seen" timestamp for each card', () => {
    const html = renderToStaticMarkup(
      <EvidenceList rows={SAMPLE_ROWS} sourcesEnabled={true} />,
    );
    expect(html).toContain('Last seen');
  });

  it('does NOT render the empty banner when rows are present and flag is on', () => {
    const html = renderToStaticMarkup(
      <EvidenceList rows={SAMPLE_ROWS} sourcesEnabled={true} />,
    );
    // The graceful-empty banner copy should not appear
    expect(html).not.toContain('Everything Nibbin has read or watched');
  });
});
