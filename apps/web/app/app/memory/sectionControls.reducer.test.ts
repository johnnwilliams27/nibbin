/**
 * Task 6 — sectionControls.reducer.test.ts
 *
 * Pure unit tests for the section controls state machine.
 * No DOM, no jsdom, no React.
 *
 * Covers:
 *  - MOVE_UP swaps sort_order with the previous sibling
 *  - MOVE_DOWN swaps sort_order with the next sibling
 *  - CONFIRM_REMOVE on a DEFAULT key produces upsert(is_hidden:true) intent
 *  - CONFIRM_REMOVE on a CUSTOM key (^c_) produces delete intent
 *  - START_ADD / EDIT_LABEL / CANCEL round-trips
 *  - Adding requires non-empty label (empty label → stays in 'adding' with error)
 */

import { describe, it, expect } from 'vitest';
import {
  sectionControlsReducer,
  initialSectionControlsState,
  type SectionControlsState,
} from './sectionControls.reducer';
import type { SectionDescriptor } from './registry';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeSection(key: string, label: string, sortOrder: number, isCustom = false): SectionDescriptor {
  return { key, label, kind: 'paragraphs', sortOrder, isCustom };
}

const defaultSections: SectionDescriptor[] = [
  makeSection('about', 'About', 100),
  makeSection('offering', 'Offering', 200),
  makeSection('how', 'How I Work', 300),
  makeSection('pricing', 'Pricing', 400),
];

function idleState(sections: SectionDescriptor[]): SectionControlsState {
  return initialSectionControlsState(sections);
}

// ---------------------------------------------------------------------------
// initialSectionControlsState
// ---------------------------------------------------------------------------

describe('sectionControlsReducer — initialSectionControlsState', () => {
  it('starts in idle mode with no pending intent', () => {
    const s = initialSectionControlsState(defaultSections);
    expect(s.mode).toBe('idle');
    expect(s.pendingIntent).toBeNull();
    expect(s.addLabel).toBe('');
    expect(s.addError).toBeNull();
  });

  it('stores the sections array', () => {
    const s = initialSectionControlsState(defaultSections);
    expect(s.sections).toHaveLength(4);
    expect(s.sections[0].key).toBe('about');
  });
});

// ---------------------------------------------------------------------------
// MOVE_UP
// ---------------------------------------------------------------------------

describe('sectionControlsReducer — MOVE_UP', () => {
  it('swaps sort_order with the previous sibling', () => {
    const state = idleState(defaultSections);
    const next = sectionControlsReducer(state, { type: 'MOVE_UP', key: 'offering' });

    // After MOVE_UP on 'offering' (sort_order 200, sibling 'about' sort_order 100):
    // offering should now have sort_order 100, about should have 200
    const offering = next.sections.find((s) => s.key === 'offering');
    const about = next.sections.find((s) => s.key === 'about');
    expect(offering!.sortOrder).toBe(100);
    expect(about!.sortOrder).toBe(200);

    // pendingIntent should be the upsert for both swapped rows
    expect(next.pendingIntent).not.toBeNull();
    expect(next.pendingIntent!.type).toBe('upsert_pair');
  });

  it('is a no-op for the first section (no previous sibling)', () => {
    const state = idleState(defaultSections);
    const next = sectionControlsReducer(state, { type: 'MOVE_UP', key: 'about' });
    // First item — no change
    const about = next.sections.find((s) => s.key === 'about');
    expect(about!.sortOrder).toBe(100);
    expect(next.pendingIntent).toBeNull();
  });

  it('re-sorts sections after swap', () => {
    const state = idleState(defaultSections);
    const next = sectionControlsReducer(state, { type: 'MOVE_UP', key: 'offering' });
    // After swap, 'offering' (now 100) should be first
    expect(next.sections[0].key).toBe('offering');
    expect(next.sections[1].key).toBe('about');
  });

  it('pendingIntent carries both swapped keys and sort_orders', () => {
    const state = idleState(defaultSections);
    const next = sectionControlsReducer(state, { type: 'MOVE_UP', key: 'offering' });
    const intent = next.pendingIntent!;
    expect(intent.type).toBe('upsert_pair');
    if (intent.type === 'upsert_pair') {
      // Should contain both keys
      const keys = intent.pairs.map((p) => p.key);
      expect(keys).toContain('offering');
      expect(keys).toContain('about');
    }
  });
});

// ---------------------------------------------------------------------------
// MOVE_DOWN
// ---------------------------------------------------------------------------

describe('sectionControlsReducer — MOVE_DOWN', () => {
  it('swaps sort_order with the next sibling', () => {
    const state = idleState(defaultSections);
    const next = sectionControlsReducer(state, { type: 'MOVE_DOWN', key: 'about' });

    // about (100) swaps with offering (200)
    const about = next.sections.find((s) => s.key === 'about');
    const offering = next.sections.find((s) => s.key === 'offering');
    expect(about!.sortOrder).toBe(200);
    expect(offering!.sortOrder).toBe(100);
  });

  it('is a no-op for the last section (no next sibling)', () => {
    const state = idleState(defaultSections);
    const next = sectionControlsReducer(state, { type: 'MOVE_DOWN', key: 'pricing' });
    const pricing = next.sections.find((s) => s.key === 'pricing');
    expect(pricing!.sortOrder).toBe(400);
    expect(next.pendingIntent).toBeNull();
  });

  it('produces upsert_pair intent with both swapped keys', () => {
    const state = idleState(defaultSections);
    const next = sectionControlsReducer(state, { type: 'MOVE_DOWN', key: 'about' });
    expect(next.pendingIntent!.type).toBe('upsert_pair');
  });
});

// ---------------------------------------------------------------------------
// CONFIRM_REMOVE — default section → upsert(is_hidden:true)
// ---------------------------------------------------------------------------

describe('sectionControlsReducer — CONFIRM_REMOVE (default key)', () => {
  it('produces an upsert intent with is_hidden:true for a default section', () => {
    const state = idleState(defaultSections);
    const next = sectionControlsReducer(state, { type: 'CONFIRM_REMOVE', key: 'about' });
    const intent = next.pendingIntent!;
    expect(intent).not.toBeNull();
    expect(intent.type).toBe('upsert_hide');
    if (intent.type === 'upsert_hide') {
      expect(intent.key).toBe('about');
      expect(intent.isHidden).toBe(true);
    }
  });

  it('does NOT produce a delete intent for a default section', () => {
    const state = idleState(defaultSections);
    const next = sectionControlsReducer(state, { type: 'CONFIRM_REMOVE', key: 'pricing' });
    expect(next.pendingIntent!.type).not.toBe('delete');
  });

  it('returns to idle mode after CONFIRM_REMOVE', () => {
    const state = idleState(defaultSections);
    const next = sectionControlsReducer(state, { type: 'CONFIRM_REMOVE', key: 'about' });
    expect(next.mode).toBe('idle');
  });
});

// ---------------------------------------------------------------------------
// CONFIRM_REMOVE — custom section (^c_) → delete intent
// ---------------------------------------------------------------------------

describe('sectionControlsReducer — CONFIRM_REMOVE (custom key)', () => {
  const sectionsWithCustom: SectionDescriptor[] = [
    ...defaultSections,
    makeSection('c_brand', 'Brand', 500, true),
  ];

  it('produces a delete intent for a custom section (^c_)', () => {
    const state = idleState(sectionsWithCustom);
    const next = sectionControlsReducer(state, { type: 'CONFIRM_REMOVE', key: 'c_brand' });
    const intent = next.pendingIntent!;
    expect(intent.type).toBe('delete');
    if (intent.type === 'delete') {
      expect(intent.key).toBe('c_brand');
    }
  });

  it('does NOT produce an upsert_hide intent for a custom section', () => {
    const state = idleState(sectionsWithCustom);
    const next = sectionControlsReducer(state, { type: 'CONFIRM_REMOVE', key: 'c_brand' });
    expect(next.pendingIntent!.type).not.toBe('upsert_hide');
  });

  it('custom key regex ^c_ correctly identifies custom sections', () => {
    // 'c_foo_bar' is custom
    const sections = [...defaultSections, makeSection('c_foo_bar', 'Foo Bar', 500, true)];
    const state = idleState(sections);
    const next = sectionControlsReducer(state, { type: 'CONFIRM_REMOVE', key: 'c_foo_bar' });
    expect(next.pendingIntent!.type).toBe('delete');
  });
});

// ---------------------------------------------------------------------------
// START_ADD / EDIT_LABEL / CANCEL
// ---------------------------------------------------------------------------

describe('sectionControlsReducer — START_ADD', () => {
  it('transitions to adding mode', () => {
    const state = idleState(defaultSections);
    const next = sectionControlsReducer(state, { type: 'START_ADD' });
    expect(next.mode).toBe('adding');
  });

  it('resets addLabel and addError', () => {
    const state: SectionControlsState = {
      ...idleState(defaultSections),
      addLabel: 'old',
      addError: 'previous error',
    };
    const next = sectionControlsReducer(state, { type: 'START_ADD' });
    expect(next.addLabel).toBe('');
    expect(next.addError).toBeNull();
  });
});

describe('sectionControlsReducer — EDIT_LABEL', () => {
  it('updates addLabel', () => {
    const state: SectionControlsState = { ...idleState(defaultSections), mode: 'adding' };
    const next = sectionControlsReducer(state, { type: 'EDIT_LABEL', label: 'My New Section' });
    expect(next.addLabel).toBe('My New Section');
  });

  it('clears addError when label changes', () => {
    const state: SectionControlsState = {
      ...idleState(defaultSections),
      mode: 'adding',
      addError: 'Label cannot be empty',
    };
    const next = sectionControlsReducer(state, { type: 'EDIT_LABEL', label: 'Something' });
    expect(next.addError).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// CONFIRM_ADD — requires non-empty label
// ---------------------------------------------------------------------------

describe('sectionControlsReducer — CONFIRM_ADD', () => {
  it('produces an upsert_new intent when label is non-empty', () => {
    const state: SectionControlsState = {
      ...idleState(defaultSections),
      mode: 'adding',
      addLabel: 'My New Section',
    };
    const next = sectionControlsReducer(state, { type: 'CONFIRM_ADD' });
    const intent = next.pendingIntent!;
    expect(intent.type).toBe('upsert_new');
    if (intent.type === 'upsert_new') {
      expect(intent.label).toBe('My New Section');
    }
  });

  it('sets addError and stays in adding mode when label is empty', () => {
    const state: SectionControlsState = {
      ...idleState(defaultSections),
      mode: 'adding',
      addLabel: '',
    };
    const next = sectionControlsReducer(state, { type: 'CONFIRM_ADD' });
    expect(next.mode).toBe('adding');
    expect(next.addError).not.toBeNull();
    expect(next.pendingIntent).toBeNull();
  });

  it('sets addError and stays in adding mode when label is whitespace-only', () => {
    const state: SectionControlsState = {
      ...idleState(defaultSections),
      mode: 'adding',
      addLabel: '   ',
    };
    const next = sectionControlsReducer(state, { type: 'CONFIRM_ADD' });
    expect(next.mode).toBe('adding');
    expect(next.addError).not.toBeNull();
  });

  it('returns to idle mode after successful CONFIRM_ADD', () => {
    const state: SectionControlsState = {
      ...idleState(defaultSections),
      mode: 'adding',
      addLabel: 'Brand voice',
    };
    const next = sectionControlsReducer(state, { type: 'CONFIRM_ADD' });
    expect(next.mode).toBe('idle');
  });
});

// ---------------------------------------------------------------------------
// CANCEL
// ---------------------------------------------------------------------------

describe('sectionControlsReducer — CANCEL', () => {
  it('returns to idle from adding mode', () => {
    const state: SectionControlsState = { ...idleState(defaultSections), mode: 'adding' };
    const next = sectionControlsReducer(state, { type: 'CANCEL' });
    expect(next.mode).toBe('idle');
  });

  it('clears addLabel and addError', () => {
    const state: SectionControlsState = {
      ...idleState(defaultSections),
      mode: 'adding',
      addLabel: 'Partial label',
      addError: 'Some error',
    };
    const next = sectionControlsReducer(state, { type: 'CANCEL' });
    expect(next.addLabel).toBe('');
    expect(next.addError).toBeNull();
  });

  it('clears any pending intent', () => {
    const state: SectionControlsState = {
      ...idleState(defaultSections),
      pendingIntent: { type: 'delete', key: 'c_foo' },
    };
    const next = sectionControlsReducer(state, { type: 'CANCEL' });
    expect(next.pendingIntent).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// CLEAR_INTENT — consuming the intent after submission
// ---------------------------------------------------------------------------

describe('sectionControlsReducer — CLEAR_INTENT', () => {
  it('clears the pending intent', () => {
    const state: SectionControlsState = {
      ...idleState(defaultSections),
      pendingIntent: { type: 'delete', key: 'c_foo' },
    };
    const next = sectionControlsReducer(state, { type: 'CLEAR_INTENT' });
    expect(next.pendingIntent).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Purity invariants
// ---------------------------------------------------------------------------

describe('sectionControlsReducer — purity', () => {
  it('does not mutate the input state', () => {
    const state = idleState(defaultSections);
    const frozen = Object.freeze({ ...state, sections: [...state.sections] });
    // Should not throw (frozen object mutation would throw)
    expect(() =>
      sectionControlsReducer(frozen as SectionControlsState, { type: 'START_ADD' }),
    ).not.toThrow();
  });

  it('returns a new object reference on state change', () => {
    const state = idleState(defaultSections);
    const next = sectionControlsReducer(state, { type: 'START_ADD' });
    expect(next).not.toBe(state);
  });
});
