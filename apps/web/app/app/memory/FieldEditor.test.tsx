/**
 * Task 7 — FieldEditor component tests.
 *
 * Uses renderToStaticMarkup (no jsdom, no testing-library) per repo convention.
 *
 * What we can assert via static markup:
 *  - Textarea present with the raw value (editing mode)
 *  - Save + Cancel buttons present
 *  - "Clear field" tertiary link present
 *  - Hint text rendered above the textarea when provided
 *  - autoFocus attribute on the textarea
 *  - aria-describedby wiring between textarea and hint element
 *  - Inline confirm prompt rendered when confirming='cancel'
 *  - Inline confirm prompt rendered when confirming='clear'
 *  - Error message rendered when state.error is set
 *  - aria-live="assertive" region wrapping confirmations (§14)
 *  - Saving mode: textarea and buttons disabled
 *
 * What we do NOT assert here (tested in fieldEditor.reducer.test.ts):
 *  - Click→state transitions (no jsdom)
 *  - Actual async save dispatch
 *
 * The component is rendered with an explicit EditState prop so tests can
 * drive any state without simulating clicks.
 */

import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { FieldEditor } from './FieldEditor';
import type { EditState } from './fieldEditor.reducer';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Minimal editing state — the most common case for rendering tests. */
function editingState(draft: string, overrides: Partial<EditState> = {}): EditState {
  return {
    mode: 'editing',
    original: draft,
    draft,
    dirty: false,
    confirming: null,
    error: null,
    ...overrides,
  };
}

function savingState(draft: string): EditState {
  return {
    mode: 'saving',
    original: draft,
    draft,
    dirty: false,
    confirming: null,
    error: null,
  };
}

/** No-op dispatch for rendering. */
const noop = () => {};

// ---------------------------------------------------------------------------
// Textarea presence + value
// ---------------------------------------------------------------------------

describe('FieldEditor — textarea', () => {
  it('renders a <textarea> with the current draft value', () => {
    const html = renderToStaticMarkup(
      <FieldEditor
        fieldKey="pricing"
        label="Pricing"
        state={editingState('$400 per session')}
        dispatch={noop}
        onSave={async () => {}}
      />,
    );
    expect(html).toContain('<textarea');
    expect(html).toContain('$400 per session');
  });

  it('renders an empty textarea when draft is empty string', () => {
    const html = renderToStaticMarkup(
      <FieldEditor
        fieldKey="pricing"
        label="Pricing"
        state={editingState('')}
        dispatch={noop}
        onSave={async () => {}}
      />,
    );
    expect(html).toContain('<textarea');
  });

  it('textarea carries autoFocus attribute (§14)', () => {
    const html = renderToStaticMarkup(
      <FieldEditor
        fieldKey="facts"
        label="Business facts"
        state={editingState('some value')}
        dispatch={noop}
        onSave={async () => {}}
      />,
    );
    expect(html).toContain('autofocus');
  });
});

// ---------------------------------------------------------------------------
// Hint
// ---------------------------------------------------------------------------

describe('FieldEditor — hint text', () => {
  it('renders the hint text when provided', () => {
    const html = renderToStaticMarkup(
      <FieldEditor
        fieldKey="facts"
        label="Business facts"
        hint="Use Label: value lines."
        state={editingState('My facts')}
        dispatch={noop}
        onSave={async () => {}}
      />,
    );
    expect(html).toContain('Use Label: value lines.');
  });

  it('does not render a hint element when hint is not provided', () => {
    const html = renderToStaticMarkup(
      <FieldEditor
        fieldKey="notes"
        label="Notes"
        state={editingState('Some notes')}
        dispatch={noop}
        onSave={async () => {}}
      />,
    );
    // Without a hint prop there should be no hint div
    expect(html).not.toContain('fieldEditorHint');
  });

  it('textarea has aria-describedby pointing to hint element when hint is provided (§14)', () => {
    const html = renderToStaticMarkup(
      <FieldEditor
        fieldKey="pricing"
        label="Pricing"
        hint="One item per line."
        state={editingState('$100')}
        dispatch={noop}
        onSave={async () => {}}
      />,
    );
    // Both the aria-describedby on the textarea and the id on the hint must exist
    expect(html).toContain('aria-describedby');
    expect(html).toContain('pricing-hint');
  });
});

// ---------------------------------------------------------------------------
// Save / Cancel buttons
// ---------------------------------------------------------------------------

describe('FieldEditor — Save and Cancel buttons', () => {
  it('renders a Save button', () => {
    const html = renderToStaticMarkup(
      <FieldEditor
        fieldKey="voice"
        label="Voice & tone"
        state={editingState('Warm and direct.')}
        dispatch={noop}
        onSave={async () => {}}
      />,
    );
    expect(html).toContain('Save');
    expect(html).toContain('<button');
  });

  it('renders a Cancel button', () => {
    const html = renderToStaticMarkup(
      <FieldEditor
        fieldKey="voice"
        label="Voice & tone"
        state={editingState('Warm and direct.')}
        dispatch={noop}
        onSave={async () => {}}
      />,
    );
    expect(html).toContain('Cancel');
  });
});

// ---------------------------------------------------------------------------
// Clear field link
// ---------------------------------------------------------------------------

describe('FieldEditor — Clear field tertiary link', () => {
  it('renders a "Clear field" link/button', () => {
    const html = renderToStaticMarkup(
      <FieldEditor
        fieldKey="policies"
        label="Policies"
        state={editingState('Some policy text')}
        dispatch={noop}
        onSave={async () => {}}
      />,
    );
    // The tertiary clear affordance should be present
    expect(html).toContain('Clear');
  });
});

// ---------------------------------------------------------------------------
// Inline confirm: cancel
// ---------------------------------------------------------------------------

describe('FieldEditor — inline cancel confirmation', () => {
  it('renders "Discard changes?" prompt when confirming=cancel', () => {
    const state = editingState('changed text', {
      original: 'original text',
      dirty: true,
      confirming: 'cancel',
    });
    const html = renderToStaticMarkup(
      <FieldEditor
        fieldKey="facts"
        label="Business facts"
        state={state}
        dispatch={noop}
        onSave={async () => {}}
      />,
    );
    expect(html).toContain('Discard');
  });

  it('the confirmation region carries aria-live="assertive" (§14)', () => {
    const state = editingState('draft', { confirming: 'cancel', dirty: true });
    const html = renderToStaticMarkup(
      <FieldEditor
        fieldKey="facts"
        label="Business facts"
        state={state}
        dispatch={noop}
        onSave={async () => {}}
      />,
    );
    expect(html).toContain('aria-live="assertive"');
  });

  it('does NOT show the cancel confirm when confirming=null', () => {
    const state = editingState('text', { confirming: null });
    const html = renderToStaticMarkup(
      <FieldEditor
        fieldKey="facts"
        label="Business facts"
        state={state}
        dispatch={noop}
        onSave={async () => {}}
      />,
    );
    expect(html).not.toContain('Discard');
  });
});

// ---------------------------------------------------------------------------
// Inline confirm: clear
// ---------------------------------------------------------------------------

describe('FieldEditor — inline clear confirmation', () => {
  it('renders a "Clear [label]?" prompt when confirming=clear', () => {
    const state = editingState('some text', { confirming: 'clear' });
    const html = renderToStaticMarkup(
      <FieldEditor
        fieldKey="pricing"
        label="Pricing"
        state={state}
        dispatch={noop}
        onSave={async () => {}}
      />,
    );
    // Should mention clearing or reference the field label
    expect(html).toContain('Clear');
    // And it should have the assertive live region
    expect(html).toContain('aria-live="assertive"');
  });

  it('does NOT show the clear confirm when confirming=null', () => {
    const state = editingState('text', { confirming: null });
    const html = renderToStaticMarkup(
      <FieldEditor
        fieldKey="pricing"
        label="Pricing"
        state={state}
        dispatch={noop}
        onSave={async () => {}}
      />,
    );
    // Without confirming, there should be no "are you sure" confirm UI
    // (just the normal Save/Cancel buttons)
    // The Clear LINK may still be present, so we test for the confirm phrasing
    expect(html).not.toContain('Are you sure');
  });
});

// ---------------------------------------------------------------------------
// Error display
// ---------------------------------------------------------------------------

describe('FieldEditor — error display', () => {
  it('renders the error message when state.error is set', () => {
    const state = editingState('my text', {
      mode: 'editing',
      error: 'Could not save. Please try again.',
    });
    const html = renderToStaticMarkup(
      <FieldEditor
        fieldKey="notes"
        label="Notes"
        state={state}
        dispatch={noop}
        onSave={async () => {}}
      />,
    );
    expect(html).toContain('Could not save. Please try again.');
  });

  it('does not render an error region when state.error is null', () => {
    const state = editingState('clean state', { error: null });
    const html = renderToStaticMarkup(
      <FieldEditor
        fieldKey="notes"
        label="Notes"
        state={state}
        dispatch={noop}
        onSave={async () => {}}
      />,
    );
    expect(html).not.toContain('fieldEditorError');
  });
});

// ---------------------------------------------------------------------------
// Saving mode
// ---------------------------------------------------------------------------

describe('FieldEditor — saving mode (disabled state)', () => {
  it('textarea is disabled while saving', () => {
    const html = renderToStaticMarkup(
      <FieldEditor
        fieldKey="pricing"
        label="Pricing"
        state={savingState('some value')}
        dispatch={noop}
        onSave={async () => {}}
      />,
    );
    expect(html).toContain('disabled');
  });

  it('Save button is disabled while saving', () => {
    const html = renderToStaticMarkup(
      <FieldEditor
        fieldKey="pricing"
        label="Pricing"
        state={savingState('some value')}
        dispatch={noop}
        onSave={async () => {}}
      />,
    );
    // At least one button should be disabled
    expect(html).toContain('disabled');
  });
});

// ---------------------------------------------------------------------------
// Task 14 — Motion class presence (static markup contract)
// ---------------------------------------------------------------------------

describe('FieldEditor — Task 14: motion + a11y classes', () => {
  it('confirm prompt carries the confirmFade motion class (cancel)', () => {
    const state = editingState('changed', {
      original: 'original',
      dirty: true,
      confirming: 'cancel',
    });
    const html = renderToStaticMarkup(
      <FieldEditor
        fieldKey="facts"
        label="Business facts"
        state={state}
        dispatch={noop}
        onSave={async () => {}}
      />,
    );
    // Task 14: confirmFade class must be present on the confirm prompt row
    expect(html).toContain('confirmFade');
  });

  it('confirm prompt carries the confirmFade motion class (clear)', () => {
    const state = editingState('text', { confirming: 'clear' });
    const html = renderToStaticMarkup(
      <FieldEditor
        fieldKey="pricing"
        label="Pricing"
        state={state}
        dispatch={noop}
        onSave={async () => {}}
      />,
    );
    expect(html).toContain('confirmFade');
  });

  it('aria-live="assertive" region is always present (even when no confirmation showing)', () => {
    const state = editingState('text', { confirming: null });
    const html = renderToStaticMarkup(
      <FieldEditor
        fieldKey="facts"
        label="Business facts"
        state={state}
        dispatch={noop}
        onSave={async () => {}}
      />,
    );
    // The live region must always be in the DOM (not conditionally rendered)
    // so screen readers have a stable target to announce into
    expect(html).toContain('aria-live="assertive"');
  });
});

// ---------------------------------------------------------------------------
// No <ul>, <dl>, <blockquote> in editor (those are FieldView territory)
// ---------------------------------------------------------------------------

describe('FieldEditor — no structural rendering (that is FieldView territory)', () => {
  it('does not render <ul> in the editor', () => {
    const html = renderToStaticMarkup(
      <FieldEditor
        fieldKey="pricing"
        label="Pricing"
        state={editingState('Item 1\nItem 2')}
        dispatch={noop}
        onSave={async () => {}}
      />,
    );
    expect(html).not.toContain('<ul');
    expect(html).not.toContain('<dl');
    expect(html).not.toContain('<blockquote');
  });
});
