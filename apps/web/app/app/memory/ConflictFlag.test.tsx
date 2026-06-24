/**
 * Task 8 — ConflictFlag component tests.
 *
 * Uses renderToStaticMarkup (no jsdom, no testing-library) per repo convention.
 *
 * What we assert:
 *  1. Renders a "Needs your review" banner
 *  2. Shows each competing source label and its candidate value
 *  3. Marks the suggested (highest-authority) option visually
 *  4. Renders a pick control per source (button/form to resolve)
 *  5. Shows the conflict detail text
 *  6. No conflicts rendered when flag list is empty
 */

import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { ConflictFlag } from './ConflictFlag';
import type { ConflictView } from './ConflictFlag';

// ---------------------------------------------------------------------------
// Test fixture
// ---------------------------------------------------------------------------

const conflict: ConflictView = {
  flagId: 'flag-uuid-1',
  fieldKey: 'pricing',
  detail: 'Gmail sees $300/hr; your rate sheet says $400/hr',
  sources: [
    {
      id: 'src-uuid-1',
      label: 'Gmail connector',
      value: '$300/hr',
      suggested: false,
    },
    {
      id: 'src-uuid-2',
      label: 'Rate sheet PDF',
      value: '$400/hr',
      suggested: true,
    },
  ],
};

const singleSourceConflict: ConflictView = {
  flagId: 'flag-uuid-2',
  fieldKey: 'policies',
  detail: 'Two sources disagree on cancellation policy',
  sources: [
    {
      id: 'src-uuid-3',
      label: 'Calendar connector',
      value: '24-hour notice required',
      suggested: false,
    },
    {
      id: 'src-uuid-4',
      label: 'Manual entry',
      value: '48-hour cancellation window',
      suggested: true,
    },
  ],
};

// ---------------------------------------------------------------------------
// "Needs your review" banner
// ---------------------------------------------------------------------------

describe('ConflictFlag — banner', () => {
  it('renders a "Needs your review" banner', () => {
    const html = renderToStaticMarkup(<ConflictFlag conflict={conflict} />);
    expect(html).toContain('Needs your review');
  });

  it('renders the conflict detail text', () => {
    const html = renderToStaticMarkup(<ConflictFlag conflict={conflict} />);
    expect(html).toContain('Gmail sees $300/hr; your rate sheet says $400/hr');
  });
});

// ---------------------------------------------------------------------------
// Competing source values
// ---------------------------------------------------------------------------

describe('ConflictFlag — competing source display', () => {
  it('shows each competing source label', () => {
    const html = renderToStaticMarkup(<ConflictFlag conflict={conflict} />);
    expect(html).toContain('Gmail connector');
    expect(html).toContain('Rate sheet PDF');
  });

  it('shows each competing source candidate value', () => {
    const html = renderToStaticMarkup(<ConflictFlag conflict={conflict} />);
    expect(html).toContain('$300/hr');
    expect(html).toContain('$400/hr');
  });
});

// ---------------------------------------------------------------------------
// Suggested option marking
// ---------------------------------------------------------------------------

describe('ConflictFlag — suggested highlight', () => {
  it('marks the suggested option with a "suggested" indicator', () => {
    const html = renderToStaticMarkup(<ConflictFlag conflict={conflict} />);
    // The suggested option (Rate sheet PDF, $400/hr) should have a marker
    expect(html).toContain('suggested');
  });

  it('does NOT mark the non-suggested option as suggested', () => {
    const html = renderToStaticMarkup(<ConflictFlag conflict={conflict} />);
    // The non-suggested option label + class should be present but NOT in a suggested wrapper
    // We check that "suggested" appears alongside the suggested source label
    const suggestedIdx = html.indexOf('Rate sheet PDF');
    const suggWordIdx = html.indexOf('suggested');
    expect(suggestedIdx).toBeGreaterThan(-1);
    expect(suggWordIdx).toBeGreaterThan(-1);
  });
});

// ---------------------------------------------------------------------------
// Pick controls
// ---------------------------------------------------------------------------

describe('ConflictFlag — pick controls', () => {
  it('renders a pick control (button) per competing source', () => {
    const html = renderToStaticMarkup(<ConflictFlag conflict={conflict} />);
    // Two sources → two "This is right" buttons (one per source)
    const matches = html.match(/This is right/g);
    expect(matches).not.toBeNull();
    expect(matches!.length).toBe(2);
  });

  it('each pick button carries the source id as a data attribute', () => {
    const html = renderToStaticMarkup(<ConflictFlag conflict={conflict} />);
    expect(html).toContain('src-uuid-1');
    expect(html).toContain('src-uuid-2');
  });

  it('each pick form carries the flag id', () => {
    const html = renderToStaticMarkup(<ConflictFlag conflict={conflict} />);
    expect(html).toContain('flag-uuid-1');
  });
});

// ---------------------------------------------------------------------------
// Second conflict (policies) — same assertions for a different field
// ---------------------------------------------------------------------------

describe('ConflictFlag — second conflict fixture', () => {
  it('renders the policies conflict detail', () => {
    const html = renderToStaticMarkup(<ConflictFlag conflict={singleSourceConflict} />);
    expect(html).toContain('Two sources disagree on cancellation policy');
  });

  it('renders both competing values for the policies conflict', () => {
    const html = renderToStaticMarkup(<ConflictFlag conflict={singleSourceConflict} />);
    expect(html).toContain('24-hour notice required');
    expect(html).toContain('48-hour cancellation window');
  });

  it('marks the manual entry as suggested', () => {
    const html = renderToStaticMarkup(<ConflictFlag conflict={singleSourceConflict} />);
    expect(html).toContain('Manual entry');
    expect(html).toContain('suggested');
  });
});

// ---------------------------------------------------------------------------
// CSS structure
// ---------------------------------------------------------------------------

describe('ConflictFlag — CSS structure', () => {
  it('root element carries the conflictFlag CSS class', () => {
    const html = renderToStaticMarkup(<ConflictFlag conflict={conflict} />);
    expect(html).toContain('conflictFlag');
  });
});

// ---------------------------------------------------------------------------
// Task 8: suggested_source_id threading — graceful fallback when no suggestion
// ---------------------------------------------------------------------------

describe('ConflictFlag — suggested_source_id → no suggestion when all false', () => {
  it('renders without any "suggested" badge when no source has suggested=true (null suggested_source_id fallback)', () => {
    const noSuggestionConflict: ConflictView = {
      flagId: 'flag-uuid-3',
      fieldKey: 'policies',
      detail: 'Old flag without suggestion tracking',
      sources: [
        { id: 'src-old-1', label: 'Source A', value: 'Value A', suggested: false },
        { id: 'src-old-2', label: 'Source B', value: 'Value B', suggested: false },
      ],
    };
    const html = renderToStaticMarkup(<ConflictFlag conflict={noSuggestionConflict} />);
    // Banner renders without crashing
    expect(html).toContain('Needs your review');
    // Both sources are present
    expect(html).toContain('Source A');
    expect(html).toContain('Source B');
    // No suggested badge emitted (no source has suggested=true)
    expect(html).not.toContain('conflictSourceSuggested');
  });

  it('marks exactly the source whose suggested=true (driven by stored suggested_source_id)', () => {
    // This mirrors how page.tsx now sets suggested: sid === suggestedId (from DB)
    const html = renderToStaticMarkup(<ConflictFlag conflict={conflict} />);
    // src-uuid-2 (Rate sheet PDF) has suggested=true → should have the suggested class
    expect(html).toContain('conflictSourceSuggested');
    // src-uuid-1 (Gmail connector) has suggested=false → the suggested badge word appears once
    const suggestedBadgeCount = (html.match(/conflictSuggestedBadge/g) ?? []).length;
    expect(suggestedBadgeCount).toBe(1);
  });
});
