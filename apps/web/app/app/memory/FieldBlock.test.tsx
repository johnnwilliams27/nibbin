/**
 * Task 8 — FieldBlock component tests.
 *
 * Uses renderToStaticMarkup (no jsdom, no testing-library) per repo convention.
 *
 * What we assert via static markup:
 *  - View mode: renders FieldView content + an Edit button with aria-label="Edit {label}"
 *  - View mode: reserves a fixed-height provenance slot element that is empty (no text) pre-F1
 *  - View mode: field header area carries the label
 *  - Edit mode: renders FieldEditor (textarea + Save/Cancel) when mode prop indicates editing
 *  - Provenance slot: with fieldMeta provided, renders provenance line text
 *  - Provenance slot: without fieldMeta, the slot element exists but contains no text
 *
 * What we do NOT assert (no jsdom — click→state transitions are reducer-tested):
 *  - Actual toggle on Edit button click
 *  - Save dispatch
 *
 * The component accepts an explicit `mode` prop (for static-markup testing) so
 * tests can drive view vs. edit state without simulating DOM events.
 */

import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { FieldBlock } from './FieldBlock';
import type { FieldMeta } from './FieldBlock';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** No-op async save — FieldBlock requires onSave callback */
const noopSave = async (_field: string, _value: string): Promise<void> => {};

// ---------------------------------------------------------------------------
// View mode
// ---------------------------------------------------------------------------

describe('FieldBlock — view mode', () => {
  it('renders an Edit button with the correct aria-label', () => {
    const html = renderToStaticMarkup(
      <FieldBlock
        fieldKey="pricing"
        label="Pricing"
        rawValue="Standard session: $400"
        onSave={noopSave}
        testMode="view"
      />,
    );
    expect(html).toContain('Edit');
    expect(html).toContain('aria-label="Edit Pricing"');
  });

  it('renders the field label in the header', () => {
    const html = renderToStaticMarkup(
      <FieldBlock
        fieldKey="facts"
        label="Business facts"
        rawValue="Location: Portland"
        onSave={noopSave}
        testMode="view"
      />,
    );
    expect(html).toContain('Business facts');
  });

  it('renders formatted field content (FieldView output)', () => {
    const html = renderToStaticMarkup(
      <FieldBlock
        fieldKey="pricing"
        label="Pricing"
        rawValue="Standard session: $400"
        onSave={noopSave}
        testMode="view"
      />,
    );
    // FieldView should render the list item
    expect(html).toContain('Standard session:');
  });

  it('renders an empty placeholder when rawValue is blank', () => {
    const html = renderToStaticMarkup(
      <FieldBlock
        fieldKey="pricing"
        label="Pricing"
        rawValue=""
        onSave={noopSave}
        testMode="view"
      />,
    );
    // FieldView in empty mode renders the field's placeholder text (from FIELD_CONFIG)
    // The pricing placeholder is "Standard session: $400..."
    expect(html).toContain('Standard session:');
  });

  it('does NOT render a <textarea> in view mode', () => {
    const html = renderToStaticMarkup(
      <FieldBlock
        fieldKey="facts"
        label="Business facts"
        rawValue="Some content"
        onSave={noopSave}
        testMode="view"
      />,
    );
    expect(html).not.toContain('<textarea');
  });
});

// ---------------------------------------------------------------------------
// Edit mode
// ---------------------------------------------------------------------------

describe('FieldBlock — edit mode', () => {
  it('renders a <textarea> in edit mode', () => {
    const html = renderToStaticMarkup(
      <FieldBlock
        fieldKey="pricing"
        label="Pricing"
        rawValue="$400"
        onSave={noopSave}
        testMode="edit"
      />,
    );
    expect(html).toContain('<textarea');
  });

  it('renders Save and Cancel buttons in edit mode', () => {
    const html = renderToStaticMarkup(
      <FieldBlock
        fieldKey="voice"
        label="Voice & tone"
        rawValue="Warm and direct."
        onSave={noopSave}
        testMode="edit"
      />,
    );
    expect(html).toContain('Save');
    expect(html).toContain('Cancel');
  });

  it('does NOT render an Edit button in edit mode', () => {
    const html = renderToStaticMarkup(
      <FieldBlock
        fieldKey="notes"
        label="Notes"
        rawValue="Some notes"
        onSave={noopSave}
        testMode="edit"
      />,
    );
    // In edit mode, the edit button is hidden/removed
    expect(html).not.toContain('aria-label="Edit Notes"');
  });
});

// ---------------------------------------------------------------------------
// Provenance slot — pre-F1 empty state (§11 / §226)
// ---------------------------------------------------------------------------

describe('FieldBlock — provenance slot (pre-F1, graceful empty)', () => {
  it('renders the provenance slot element when no fieldMeta is provided', () => {
    const html = renderToStaticMarkup(
      <FieldBlock
        fieldKey="pricing"
        label="Pricing"
        rawValue="$400"
        onSave={noopSave}
        testMode="view"
      />,
    );
    // The slot element must exist (for layout reservation)
    expect(html).toContain('provenanceSlot');
  });

  it('provenance slot is empty pre-F1 (no fabricated text, no "unknown")', () => {
    const html = renderToStaticMarkup(
      <FieldBlock
        fieldKey="pricing"
        label="Pricing"
        rawValue="$400"
        onSave={noopSave}
        testMode="view"
      />,
    );
    // The slot must not contain any fabricated text
    expect(html).not.toContain('unknown');
    expect(html).not.toContain('Updated');
    // Extract the provenance slot content — it should be empty
    const slotMatch = html.match(/provenanceSlot[^>]*>([^<]*)</);
    if (slotMatch) {
      // If the slot element is found, its direct text content should be empty
      expect(slotMatch[1].trim()).toBe('');
    }
  });

  it('provenance slot renders a source label when fieldMeta is provided', () => {
    const fieldMeta: FieldMeta = {
      source: 'user_entered',
      lastReviewedAt: '2026-06-01T00:00:00Z',
    };
    const html = renderToStaticMarkup(
      <FieldBlock
        fieldKey="pricing"
        label="Pricing"
        rawValue="$400"
        onSave={noopSave}
        testMode="view"
        fieldMeta={fieldMeta}
      />,
    );
    // With meta provided, the provenance label should be rendered
    expect(html).toContain('You wrote this');
  });

  it('provenance slot renders staleness warning when lastReviewedAt is old', () => {
    const fieldMeta: FieldMeta = {
      source: 'field_study',
      // Old date — more than 60 days ago
      lastReviewedAt: '2025-01-01T00:00:00Z',
    };
    const html = renderToStaticMarkup(
      <FieldBlock
        fieldKey="facts"
        label="Business facts"
        rawValue="Location: Portland"
        onSave={noopSave}
        testMode="view"
        fieldMeta={fieldMeta}
      />,
    );
    // Stale content gets a "worth a check?" hint
    expect(html).toContain('worth a check');
  });
});

// ---------------------------------------------------------------------------
// Task 14 — Motion classes (static markup contract)
// ---------------------------------------------------------------------------

describe('FieldBlock — Task 14: motion classes', () => {
  it('view mode content area carries the fieldContent motion class', () => {
    const html = renderToStaticMarkup(
      <FieldBlock
        fieldKey="pricing"
        label="Pricing"
        rawValue="$400"
        onSave={noopSave}
        testMode="view"
      />,
    );
    // Task 14: fieldContent class provides the view↔edit crossfade
    expect(html).toContain('fieldContent');
  });

  it('edit mode content area carries the fieldContentEdit motion class', () => {
    const html = renderToStaticMarkup(
      <FieldBlock
        fieldKey="pricing"
        label="Pricing"
        rawValue="$400"
        onSave={noopSave}
        testMode="edit"
      />,
    );
    // Task 14: fieldContentEdit class provides the edit-mode fade-in
    expect(html).toContain('fieldContentEdit');
  });
});

// ---------------------------------------------------------------------------
// CSS classes — structural contract
// ---------------------------------------------------------------------------

describe('FieldBlock — structural CSS classes', () => {
  it('root element carries the field class', () => {
    const html = renderToStaticMarkup(
      <FieldBlock
        fieldKey="facts"
        label="Business facts"
        rawValue="Location: Portland"
        onSave={noopSave}
        testMode="view"
      />,
    );
    expect(html).toContain('fieldBlock');
  });

  it('header area carries the fieldHeader class', () => {
    const html = renderToStaticMarkup(
      <FieldBlock
        fieldKey="facts"
        label="Business facts"
        rawValue=""
        onSave={noopSave}
        testMode="view"
      />,
    );
    expect(html).toContain('fieldHeader');
  });
});
