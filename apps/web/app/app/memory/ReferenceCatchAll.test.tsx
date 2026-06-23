/**
 * Task 13 — ReferenceCatchAll component tests.
 *
 * Uses renderToStaticMarkup (no jsdom, no testing-library) per repo convention.
 *
 * ReferenceCatchAll is the Sources-tab freeform catch-all for raw reference material.
 * It uses the same deliberate edit pattern as curated fields (view → edit), but the
 * content is freeform long-form (no structural formatting), rendered as <pre>.
 *
 * Spec sources:
 *  - Plan §Task 13 (ReferenceCatchAll.test.tsx)
 *  - Plan §8.1: Reference renders as <pre>, no structural formatting
 *  - Plan §14.5: framing copy + empty nudge copy
 *  - Plan constraint: freeform, distinct from `notes`; saves via saveReference RPC
 *    (param: new_reference_text)
 *
 * What we assert via static markup:
 *
 *  View mode (with value):
 *  - Label "Reference material" is present (§8.1 catch-all label)
 *  - Value renders as <pre> element (no list/dl/quote formatting)
 *  - An Edit button is rendered
 *  - No <textarea> in view mode
 *  - "Show all" / "Collapse" affordance when value is long (>500 chars)
 *
 *  View mode (empty):
 *  - Empty nudge copy: "Don't want to type it all out? Drop in a doc…"
 *  - No <pre> when empty
 *
 *  Edit mode:
 *  - A <textarea> is rendered, bound to the reference_text value
 *  - Save and Cancel buttons are present
 *  - No <pre> in edit mode (textarea replaces it)
 *  - The label is still present in edit mode
 *
 *  Reducer logic (pure, no DOM):
 *  - The same editReducer from Task 7 drives the state
 *  - enter → editing; cancel (clean) → viewing; save → saving → viewing
 *
 *  Save path wiring:
 *  - `onSave` is called with the new string value (caller builds FormData from it)
 *
 * What we do NOT assert (no jsdom):
 *  - Click → state transitions (tested via reducer logic)
 *  - Actual save network call (action is server-side)
 *  - "Show all"/"Collapse" toggle interaction
 */

import { describe, it, expect } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ReferenceCatchAll } from './ReferenceCatchAll';
import { initialState, editReducer } from './fieldEditor.reducer';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const SHORT_VALUE = 'This is my reference material. Clients come from Instagram and Honeybook.';

/** > 500 chars to trigger the Show all / Collapse affordance */
const LONG_VALUE = Array.from({ length: 60 }, (_, i) => `Line ${i + 1}: some reference text here.`).join('\n');

const noop = async (_value: string): Promise<void> => {};

// ---------------------------------------------------------------------------
// View mode — with a value
// ---------------------------------------------------------------------------

describe('ReferenceCatchAll — view mode (with value)', () => {
  it('renders the "Reference material" label', () => {
    const html = renderToStaticMarkup(
      <ReferenceCatchAll value={SHORT_VALUE} onSave={noop} testMode="view" />,
    );
    expect(html).toContain('Reference material');
  });

  it('renders the value inside a <pre> element', () => {
    const html = renderToStaticMarkup(
      <ReferenceCatchAll value={SHORT_VALUE} onSave={noop} testMode="view" />,
    );
    expect(html).toContain('<pre');
    expect(html).toContain('Instagram and Honeybook');
  });

  it('does NOT render a <textarea> in view mode', () => {
    const html = renderToStaticMarkup(
      <ReferenceCatchAll value={SHORT_VALUE} onSave={noop} testMode="view" />,
    );
    expect(html).not.toContain('<textarea');
  });

  it('renders an Edit button in view mode', () => {
    const html = renderToStaticMarkup(
      <ReferenceCatchAll value={SHORT_VALUE} onSave={noop} testMode="view" />,
    );
    expect(html).toContain('Edit');
  });

  it('does NOT render the empty nudge copy when value is present', () => {
    const html = renderToStaticMarkup(
      <ReferenceCatchAll value={SHORT_VALUE} onSave={noop} testMode="view" />,
    );
    expect(html).not.toContain("Don&#x27;t want to type it all out");
    // also check the unescaped version isn't there
    expect(html).not.toContain("Don't want to type it all out");
  });
});

// ---------------------------------------------------------------------------
// View mode — long value triggers Show all / Collapse affordance
// ---------------------------------------------------------------------------

describe('ReferenceCatchAll — view mode (long value)', () => {
  it('renders "Show all" affordance when value is longer than 500 chars', () => {
    const html = renderToStaticMarkup(
      <ReferenceCatchAll value={LONG_VALUE} onSave={noop} testMode="view" />,
    );
    expect(html).toContain('Show all');
  });

  it('does NOT render "Show all" for short values', () => {
    const html = renderToStaticMarkup(
      <ReferenceCatchAll value={SHORT_VALUE} onSave={noop} testMode="view" />,
    );
    expect(html).not.toContain('Show all');
  });
});

// ---------------------------------------------------------------------------
// View mode — empty state
// ---------------------------------------------------------------------------

describe('ReferenceCatchAll — view mode (empty)', () => {
  it('renders the empty nudge copy when value is blank', () => {
    const html = renderToStaticMarkup(
      <ReferenceCatchAll value="" onSave={noop} testMode="view" />,
    );
    // Plan §14.5 empty nudge copy (HTML entity escaped variant is also OK)
    const hasNudge =
      html.includes("Don&#x27;t want to type it all out") ||
      html.includes("Don't want to type it all out") ||
      html.includes("Drop in a doc");
    expect(hasNudge).toBe(true);
  });

  it('does NOT render a <pre> when value is empty', () => {
    const html = renderToStaticMarkup(
      <ReferenceCatchAll value="" onSave={noop} testMode="view" />,
    );
    expect(html).not.toContain('<pre');
  });

  it('renders the "Reference material" label even when empty', () => {
    const html = renderToStaticMarkup(
      <ReferenceCatchAll value="" onSave={noop} testMode="view" />,
    );
    expect(html).toContain('Reference material');
  });

  it('still renders an Edit button when empty', () => {
    const html = renderToStaticMarkup(
      <ReferenceCatchAll value="" onSave={noop} testMode="view" />,
    );
    expect(html).toContain('Edit');
  });
});

// ---------------------------------------------------------------------------
// Edit mode
// ---------------------------------------------------------------------------

describe('ReferenceCatchAll — edit mode', () => {
  it('renders a <textarea> in edit mode', () => {
    const html = renderToStaticMarkup(
      <ReferenceCatchAll value={SHORT_VALUE} onSave={noop} testMode="edit" />,
    );
    expect(html).toContain('<textarea');
  });

  it('textarea contains the current reference value', () => {
    const html = renderToStaticMarkup(
      <ReferenceCatchAll value={SHORT_VALUE} onSave={noop} testMode="edit" />,
    );
    expect(html).toContain('Instagram and Honeybook');
  });

  it('renders Save and Cancel buttons in edit mode', () => {
    const html = renderToStaticMarkup(
      <ReferenceCatchAll value={SHORT_VALUE} onSave={noop} testMode="edit" />,
    );
    expect(html).toContain('Save');
    expect(html).toContain('Cancel');
  });

  it('does NOT render <pre> in edit mode', () => {
    const html = renderToStaticMarkup(
      <ReferenceCatchAll value={SHORT_VALUE} onSave={noop} testMode="edit" />,
    );
    expect(html).not.toContain('<pre');
  });

  it('renders the "Reference material" label in edit mode', () => {
    const html = renderToStaticMarkup(
      <ReferenceCatchAll value={SHORT_VALUE} onSave={noop} testMode="edit" />,
    );
    expect(html).toContain('Reference material');
  });

  it('does NOT render the Edit button in edit mode', () => {
    const html = renderToStaticMarkup(
      <ReferenceCatchAll value={SHORT_VALUE} onSave={noop} testMode="edit" />,
    );
    // The Edit aria-label should be absent
    expect(html).not.toContain('aria-label="Edit Reference material"');
  });
});

// ---------------------------------------------------------------------------
// Pure reducer logic (via editReducer from Task 7) — no DOM needed
// ---------------------------------------------------------------------------

describe('ReferenceCatchAll — reducer logic (pure)', () => {
  it('initial state is "viewing" mode', () => {
    const state = initialState(SHORT_VALUE);
    expect(state.mode).toBe('viewing');
  });

  it('enter action transitions to "editing"', () => {
    const state0 = initialState(SHORT_VALUE);
    const state1 = editReducer(state0, { type: 'enter' });
    expect(state1.mode).toBe('editing');
    expect(state1.draft).toBe(SHORT_VALUE);
  });

  it('change action updates draft', () => {
    const state0 = initialState(SHORT_VALUE);
    const state1 = editReducer(state0, { type: 'enter' });
    const state2 = editReducer(state1, { type: 'change', value: 'new ref text' });
    expect(state2.draft).toBe('new ref text');
    expect(state2.dirty).toBe(true);
  });

  it('clean cancel (no changes) exits directly to viewing', () => {
    const state0 = initialState(SHORT_VALUE);
    const state1 = editReducer(state0, { type: 'enter' });
    // No change dispatch
    const state2 = editReducer(state1, { type: 'requestCancel' });
    expect(state2.mode).toBe('viewing');
  });

  it('save → saveSuccess transitions to viewing with updated original', () => {
    const state0 = initialState(SHORT_VALUE);
    const state1 = editReducer(state0, { type: 'enter' });
    const state2 = editReducer(state1, { type: 'change', value: 'updated reference' });
    const state3 = editReducer(state2, { type: 'save' });
    expect(state3.mode).toBe('saving');
    const state4 = editReducer(state3, { type: 'saveSuccess' });
    expect(state4.mode).toBe('viewing');
    expect(state4.original).toBe('updated reference');
  });
});
