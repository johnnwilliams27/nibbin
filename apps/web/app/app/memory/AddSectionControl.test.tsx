/**
 * Task 6 — AddSectionControl.test.tsx
 *
 * Render tests via renderToStaticMarkup (no jsdom, no testing-library).
 *
 * Tests:
 *  - In edit context (isEditing=true): renders the "+ Add a section" button/affordance
 *  - In edit context with mode='adding': renders the label input + confirm/cancel controls
 *  - In view context (isEditing=false): does NOT render the add affordance
 *  - Error message appears when addError is set
 */

import { describe, it, expect } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { AddSectionControl } from './AddSectionControl';
import type { SectionControlsState } from './sectionControls.reducer';
import type { SectionDescriptor } from './registry';

const noopDispatch = () => {};
const noopOnIntent = async () => {};

const mockSections: SectionDescriptor[] = [
  { key: 'about', label: 'About', kind: 'paragraphs', sortOrder: 100 },
];

function idleState(): SectionControlsState {
  return {
    sections: mockSections,
    mode: 'idle',
    addLabel: '',
    addError: null,
    pendingIntent: null,
  };
}

function addingState(label = '', error: string | null = null): SectionControlsState {
  return {
    sections: mockSections,
    mode: 'adding',
    addLabel: label,
    addError: error,
    pendingIntent: null,
  };
}

// ---------------------------------------------------------------------------
// View mode (isEditing=false) — controls hidden
// ---------------------------------------------------------------------------

describe('AddSectionControl — view mode (isEditing=false)', () => {
  it('does NOT render the add affordance in view mode', () => {
    const html = renderToStaticMarkup(
      <AddSectionControl
        state={idleState()}
        dispatch={noopDispatch}
        onIntent={noopOnIntent}
        isEditing={false}
      />,
    );
    expect(html).not.toContain('Add a section');
  });

  it('renders empty string / nothing in view mode', () => {
    const html = renderToStaticMarkup(
      <AddSectionControl
        state={idleState()}
        dispatch={noopDispatch}
        onIntent={noopOnIntent}
        isEditing={false}
      />,
    );
    // Should be empty or minimal whitespace
    expect(html.trim()).toBe('');
  });
});

// ---------------------------------------------------------------------------
// Edit mode, idle — shows "+" affordance
// ---------------------------------------------------------------------------

describe('AddSectionControl — edit mode (isEditing=true, idle)', () => {
  it('renders the "+ Add a section" affordance in edit mode', () => {
    const html = renderToStaticMarkup(
      <AddSectionControl
        state={idleState()}
        dispatch={noopDispatch}
        onIntent={noopOnIntent}
        isEditing={true}
      />,
    );
    expect(html).toContain('Add a section');
  });

  it('renders a button for adding in idle edit mode', () => {
    const html = renderToStaticMarkup(
      <AddSectionControl
        state={idleState()}
        dispatch={noopDispatch}
        onIntent={noopOnIntent}
        isEditing={true}
      />,
    );
    expect(html).toContain('<button');
  });
});

// ---------------------------------------------------------------------------
// Edit mode, adding — shows label input + confirm/cancel
// ---------------------------------------------------------------------------

describe('AddSectionControl — edit mode (isEditing=true, adding)', () => {
  it('renders a text input for the new section label', () => {
    const html = renderToStaticMarkup(
      <AddSectionControl
        state={addingState('My New Section')}
        dispatch={noopDispatch}
        onIntent={noopOnIntent}
        isEditing={true}
      />,
    );
    expect(html).toContain('<input');
    expect(html).toContain('My New Section');
  });

  it('renders a Confirm/Add button', () => {
    const html = renderToStaticMarkup(
      <AddSectionControl
        state={addingState('Test')}
        dispatch={noopDispatch}
        onIntent={noopOnIntent}
        isEditing={true}
      />,
    );
    // Some form of confirm: "Add" or "Confirm" or "Create"
    expect(html).toMatch(/Add|Confirm|Create/);
  });

  it('renders a Cancel button', () => {
    const html = renderToStaticMarkup(
      <AddSectionControl
        state={addingState()}
        dispatch={noopDispatch}
        onIntent={noopOnIntent}
        isEditing={true}
      />,
    );
    expect(html).toContain('Cancel');
  });

  it('renders the error message when addError is set', () => {
    const html = renderToStaticMarkup(
      <AddSectionControl
        state={addingState('', 'Section label cannot be empty.')}
        dispatch={noopDispatch}
        onIntent={noopOnIntent}
        isEditing={true}
      />,
    );
    expect(html).toContain('Section label cannot be empty.');
  });

  it('does NOT render the error message when addError is null', () => {
    const html = renderToStaticMarkup(
      <AddSectionControl
        state={addingState('Some label', null)}
        dispatch={noopDispatch}
        onIntent={noopOnIntent}
        isEditing={true}
      />,
    );
    expect(html).not.toContain('cannot be empty');
  });
});
