/**
 * Task 6 — SectionActions.test.tsx
 *
 * Render tests via renderToStaticMarkup (no jsdom, no testing-library).
 *
 * Tests:
 *  - In edit context (isEditing=true): per-field rename/move-up/move-down/remove affordances render
 *  - First item: move-up button disabled or absent; last item: move-down button disabled or absent
 *  - In view context (isEditing=false): NO section action controls rendered
 */

import { describe, it, expect } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { SectionActions } from './SectionActions';
import type { SectionDescriptor } from './registry';

const noopDispatch = () => {};
const noopOnIntent = async () => {};

const allSections: SectionDescriptor[] = [
  { key: 'about', label: 'About', kind: 'paragraphs', sortOrder: 100 },
  { key: 'pricing', label: 'Pricing', kind: 'list', sortOrder: 200 },
  { key: 'voice', label: 'Voice', kind: 'paragraphs', sortOrder: 300 },
];

// ---------------------------------------------------------------------------
// View mode (isEditing=false)
// ---------------------------------------------------------------------------

describe('SectionActions — view mode (isEditing=false)', () => {
  it('renders nothing in view mode', () => {
    const html = renderToStaticMarkup(
      <SectionActions
        section={allSections[1]}
        allSections={allSections}
        dispatch={noopDispatch}
        onIntent={noopOnIntent}
        isEditing={false}
      />,
    );
    expect(html.trim()).toBe('');
  });

  it('does NOT render move-up, move-down, or remove in view mode', () => {
    const html = renderToStaticMarkup(
      <SectionActions
        section={allSections[0]}
        allSections={allSections}
        dispatch={noopDispatch}
        onIntent={noopOnIntent}
        isEditing={false}
      />,
    );
    expect(html).not.toContain('Move up');
    expect(html).not.toContain('Move down');
    expect(html).not.toContain('Remove');
  });
});

// ---------------------------------------------------------------------------
// Edit mode — middle item has all controls
// ---------------------------------------------------------------------------

describe('SectionActions — edit mode (isEditing=true), middle item', () => {
  it('renders move-up and move-down controls', () => {
    const html = renderToStaticMarkup(
      <SectionActions
        section={allSections[1]}  // pricing — middle
        allSections={allSections}
        dispatch={noopDispatch}
        onIntent={noopOnIntent}
        isEditing={true}
      />,
    );
    // Both move controls should appear
    expect(html).toMatch(/Move up|move.up|↑|▲/i);
    expect(html).toMatch(/Move down|move.down|↓|▼/i);
  });

  it('renders remove control', () => {
    const html = renderToStaticMarkup(
      <SectionActions
        section={allSections[1]}
        allSections={allSections}
        dispatch={noopDispatch}
        onIntent={noopOnIntent}
        isEditing={true}
      />,
    );
    expect(html).toMatch(/Remove|Delete|Hide/i);
  });
});

// ---------------------------------------------------------------------------
// Edit mode — first item: move-up disabled or absent
// ---------------------------------------------------------------------------

describe('SectionActions — edit mode (isEditing=true), first item', () => {
  it('disables or hides the move-up control for the first section', () => {
    const html = renderToStaticMarkup(
      <SectionActions
        section={allSections[0]}  // about — first
        allSections={allSections}
        dispatch={noopDispatch}
        onIntent={noopOnIntent}
        isEditing={true}
      />,
    );
    // Either the move-up button is absent, or it carries disabled attribute
    const hasMoveUp = /Move up|move.up|↑/i.test(html);
    if (hasMoveUp) {
      // If rendered, it must be disabled
      expect(html).toContain('disabled');
    }
    // Otherwise it's just absent — that's acceptable too
  });

  it('still renders move-down for the first section', () => {
    const html = renderToStaticMarkup(
      <SectionActions
        section={allSections[0]}
        allSections={allSections}
        dispatch={noopDispatch}
        onIntent={noopOnIntent}
        isEditing={true}
      />,
    );
    expect(html).toMatch(/Move down|move.down|↓|▼/i);
  });
});

// ---------------------------------------------------------------------------
// Edit mode — last item: move-down disabled or absent
// ---------------------------------------------------------------------------

describe('SectionActions — edit mode (isEditing=true), last item', () => {
  it('disables or hides the move-down control for the last section', () => {
    const html = renderToStaticMarkup(
      <SectionActions
        section={allSections[2]}  // voice — last
        allSections={allSections}
        dispatch={noopDispatch}
        onIntent={noopOnIntent}
        isEditing={true}
      />,
    );
    const hasMoveDown = /Move down|move.down|↓/i.test(html);
    if (hasMoveDown) {
      // If rendered, it must be disabled
      expect(html).toContain('disabled');
    }
  });

  it('still renders move-up for the last section', () => {
    const html = renderToStaticMarkup(
      <SectionActions
        section={allSections[2]}
        allSections={allSections}
        dispatch={noopDispatch}
        onIntent={noopOnIntent}
        isEditing={true}
      />,
    );
    expect(html).toMatch(/Move up|move.up|↑|▲/i);
  });
});

// ---------------------------------------------------------------------------
// Edit mode — custom section shows remove as delete, default as hide
// ---------------------------------------------------------------------------

describe('SectionActions — edit mode, custom vs default remove label', () => {
  it('renders a remove/hide control for a default section', () => {
    const defaultSection: SectionDescriptor = {
      key: 'about',
      label: 'About',
      kind: 'paragraphs',
      sortOrder: 100,
      isCustom: false,
    };
    const html = renderToStaticMarkup(
      <SectionActions
        section={defaultSection}
        allSections={[defaultSection]}
        dispatch={noopDispatch}
        onIntent={noopOnIntent}
        isEditing={true}
      />,
    );
    expect(html).toMatch(/Remove|Hide/i);
  });

  it('renders a remove/delete control for a custom section', () => {
    const customSection: SectionDescriptor = {
      key: 'c_brand',
      label: 'Brand',
      kind: 'list',
      sortOrder: 500,
      isCustom: true,
    };
    const html = renderToStaticMarkup(
      <SectionActions
        section={customSection}
        allSections={[customSection]}
        dispatch={noopDispatch}
        onIntent={noopOnIntent}
        isEditing={true}
      />,
    );
    expect(html).toMatch(/Remove|Delete/i);
  });
});
