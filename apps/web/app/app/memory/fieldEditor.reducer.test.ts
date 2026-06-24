/**
 * Task 7 — fieldEditor.reducer.test.ts
 *
 * Pure unit tests for editReducer(state, action).
 * No DOM, no jsdom, no React — this is the logic that vitest CAN test directly.
 *
 * Coverage targets (plan Task 7):
 *  - enter    → switches mode to 'editing', captures original value
 *  - change   → updates draft, marks dirty
 *  - requestCancel → sets confirming='cancel' when dirty; exits immediately when clean
 *  - confirmCancel → reverts draft to original, exits edit mode, clears confirming
 *  - requestClear  → sets confirming='clear' (always confirms regardless of dirty)
 *  - confirmClear  → sets draft to '', marks dirty, clears confirming (stays in editing)
 *  - save (pending) → mode transitions to 'saving'
 *  - saveSuccess    → exits to 'viewing', updates original to the saved value
 *  - saveError      → returns to 'editing', surfaces error message
 *  - Cancel from idle (clean) skips the confirmation step entirely
 */

import { describe, it, expect } from 'vitest';
import { editReducer, initialState } from './fieldEditor.reducer';
import type { EditState } from './fieldEditor.reducer';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a state in 'editing' mode with a given original and draft. */
function editingState(original: string, draft: string, dirty = false): EditState {
  return {
    mode: 'editing',
    original,
    draft,
    dirty,
    confirming: null,
    error: null,
  };
}

// ---------------------------------------------------------------------------
// initialState
// ---------------------------------------------------------------------------

describe('editReducer — initialState', () => {
  it('starts in viewing mode with no error, no confirming, not dirty', () => {
    const s = initialState('Hello world');
    expect(s.mode).toBe('viewing');
    expect(s.original).toBe('Hello world');
    expect(s.draft).toBe('Hello world');
    expect(s.dirty).toBe(false);
    expect(s.confirming).toBeNull();
    expect(s.error).toBeNull();
  });

  it('accepts an empty string as the initial value', () => {
    const s = initialState('');
    expect(s.original).toBe('');
    expect(s.draft).toBe('');
  });
});

// ---------------------------------------------------------------------------
// enter
// ---------------------------------------------------------------------------

describe('editReducer — enter action', () => {
  it('transitions from viewing to editing', () => {
    const state = initialState('Some value');
    const next = editReducer(state, { type: 'enter' });
    expect(next.mode).toBe('editing');
  });

  it('preserves the original value', () => {
    const state = initialState('My value');
    const next = editReducer(state, { type: 'enter' });
    expect(next.original).toBe('My value');
  });

  it('sets draft equal to original on enter', () => {
    const state = initialState('Existing text');
    const next = editReducer(state, { type: 'enter' });
    expect(next.draft).toBe('Existing text');
  });

  it('clears any previous error on enter', () => {
    const state: EditState = {
      mode: 'viewing',
      original: 'x',
      draft: 'x',
      dirty: false,
      confirming: null,
      error: 'Something went wrong',
    };
    const next = editReducer(state, { type: 'enter' });
    expect(next.error).toBeNull();
  });

  it('is idempotent — enter from editing stays editing', () => {
    const state = editingState('val', 'val');
    const next = editReducer(state, { type: 'enter' });
    expect(next.mode).toBe('editing');
  });
});

// ---------------------------------------------------------------------------
// change
// ---------------------------------------------------------------------------

describe('editReducer — change action', () => {
  it('updates draft to the new value', () => {
    const state = editingState('old', 'old');
    const next = editReducer(state, { type: 'change', value: 'new text' });
    expect(next.draft).toBe('new text');
  });

  it('marks dirty=true when draft differs from original', () => {
    const state = editingState('original', 'original');
    const next = editReducer(state, { type: 'change', value: 'changed' });
    expect(next.dirty).toBe(true);
  });

  it('marks dirty=false when draft returns to original value', () => {
    const state = editingState('original', 'changed', true);
    const next = editReducer(state, { type: 'change', value: 'original' });
    expect(next.dirty).toBe(false);
  });

  it('preserves mode as editing', () => {
    const state = editingState('a', 'a');
    const next = editReducer(state, { type: 'change', value: 'b' });
    expect(next.mode).toBe('editing');
  });

  it('clears confirming on change (user typed, dismiss any pending confirm)', () => {
    const state: EditState = { ...editingState('a', 'a'), confirming: 'cancel' };
    const next = editReducer(state, { type: 'change', value: 'b' });
    expect(next.confirming).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// requestCancel
// ---------------------------------------------------------------------------

describe('editReducer — requestCancel action', () => {
  it('sets confirming="cancel" when dirty', () => {
    const state = editingState('original', 'changed', true);
    const next = editReducer(state, { type: 'requestCancel' });
    expect(next.confirming).toBe('cancel');
    expect(next.mode).toBe('editing'); // still in editing — waiting for confirm
  });

  it('exits immediately to viewing when NOT dirty (no changes to discard)', () => {
    const state = editingState('original', 'original', false);
    const next = editReducer(state, { type: 'requestCancel' });
    expect(next.mode).toBe('viewing');
    expect(next.confirming).toBeNull();
  });

  it('preserves the draft when setting confirming (does not revert yet)', () => {
    const state = editingState('original', 'changed', true);
    const next = editReducer(state, { type: 'requestCancel' });
    expect(next.draft).toBe('changed');
  });
});

// ---------------------------------------------------------------------------
// confirmCancel
// ---------------------------------------------------------------------------

describe('editReducer — confirmCancel action', () => {
  it('reverts draft to original', () => {
    const state: EditState = {
      ...editingState('original', 'changed', true),
      confirming: 'cancel',
    };
    const next = editReducer(state, { type: 'confirmCancel' });
    expect(next.draft).toBe('original');
  });

  it('transitions to viewing mode', () => {
    const state: EditState = {
      ...editingState('original', 'changed', true),
      confirming: 'cancel',
    };
    const next = editReducer(state, { type: 'confirmCancel' });
    expect(next.mode).toBe('viewing');
  });

  it('clears dirty flag', () => {
    const state: EditState = {
      ...editingState('original', 'changed', true),
      confirming: 'cancel',
    };
    const next = editReducer(state, { type: 'confirmCancel' });
    expect(next.dirty).toBe(false);
  });

  it('clears confirming', () => {
    const state: EditState = {
      ...editingState('original', 'changed', true),
      confirming: 'cancel',
    };
    const next = editReducer(state, { type: 'confirmCancel' });
    expect(next.confirming).toBeNull();
  });

  it('clears any error', () => {
    const state: EditState = {
      ...editingState('original', 'changed', true),
      confirming: 'cancel',
      error: 'previous error',
    };
    const next = editReducer(state, { type: 'confirmCancel' });
    expect(next.error).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// requestClear
// ---------------------------------------------------------------------------

describe('editReducer — requestClear action', () => {
  it('sets confirming="clear" regardless of dirty state', () => {
    // Clean state
    const cleanState = editingState('value', 'value', false);
    const next1 = editReducer(cleanState, { type: 'requestClear' });
    expect(next1.confirming).toBe('clear');
    expect(next1.mode).toBe('editing');

    // Dirty state
    const dirtyState = editingState('original', 'changed', true);
    const next2 = editReducer(dirtyState, { type: 'requestClear' });
    expect(next2.confirming).toBe('clear');
  });

  it('does not change draft when requesting clear (only confirms do the actual clear)', () => {
    const state = editingState('some value', 'some value');
    const next = editReducer(state, { type: 'requestClear' });
    expect(next.draft).toBe('some value');
  });
});

// ---------------------------------------------------------------------------
// confirmClear
// ---------------------------------------------------------------------------

describe('editReducer — confirmClear action', () => {
  it('sets draft to empty string', () => {
    const state: EditState = {
      ...editingState('some value', 'some value'),
      confirming: 'clear',
    };
    const next = editReducer(state, { type: 'confirmClear' });
    expect(next.draft).toBe('');
  });

  it('marks dirty=true (clearing is a change)', () => {
    const state: EditState = {
      ...editingState('some value', 'some value'),
      confirming: 'clear',
    };
    const next = editReducer(state, { type: 'confirmClear' });
    expect(next.dirty).toBe(true);
  });

  it('stays in editing mode (user must still save to persist the clear)', () => {
    const state: EditState = {
      ...editingState('some value', 'some value'),
      confirming: 'clear',
    };
    const next = editReducer(state, { type: 'confirmClear' });
    expect(next.mode).toBe('editing');
  });

  it('clears confirming after confirm', () => {
    const state: EditState = {
      ...editingState('some value', 'some value'),
      confirming: 'clear',
    };
    const next = editReducer(state, { type: 'confirmClear' });
    expect(next.confirming).toBeNull();
  });

  it('preserves original (clearing draft does NOT touch original)', () => {
    const state: EditState = {
      ...editingState('the original', 'the original'),
      confirming: 'clear',
    };
    const next = editReducer(state, { type: 'confirmClear' });
    expect(next.original).toBe('the original');
  });
});

// ---------------------------------------------------------------------------
// save (initiates async save)
// ---------------------------------------------------------------------------

describe('editReducer — save action', () => {
  it('transitions mode to "saving"', () => {
    const state = editingState('original', 'new value', true);
    const next = editReducer(state, { type: 'save' });
    expect(next.mode).toBe('saving');
  });

  it('clears any previous error when save starts', () => {
    const state: EditState = { ...editingState('x', 'y', true), error: 'old error' };
    const next = editReducer(state, { type: 'save' });
    expect(next.error).toBeNull();
  });

  it('preserves the current draft (the value being saved)', () => {
    const state = editingState('original', 'new value', true);
    const next = editReducer(state, { type: 'save' });
    expect(next.draft).toBe('new value');
  });
});

// ---------------------------------------------------------------------------
// saveSuccess
// ---------------------------------------------------------------------------

describe('editReducer — saveSuccess action', () => {
  it('transitions to viewing mode', () => {
    const state: EditState = {
      mode: 'saving',
      original: 'original',
      draft: 'saved value',
      dirty: true,
      confirming: null,
      error: null,
    };
    const next = editReducer(state, { type: 'saveSuccess' });
    expect(next.mode).toBe('viewing');
  });

  it('updates original to the saved draft value', () => {
    const state: EditState = {
      mode: 'saving',
      original: 'old',
      draft: 'new saved',
      dirty: true,
      confirming: null,
      error: null,
    };
    const next = editReducer(state, { type: 'saveSuccess' });
    expect(next.original).toBe('new saved');
    expect(next.draft).toBe('new saved');
  });

  it('clears dirty flag', () => {
    const state: EditState = {
      mode: 'saving',
      original: 'old',
      draft: 'new',
      dirty: true,
      confirming: null,
      error: null,
    };
    const next = editReducer(state, { type: 'saveSuccess' });
    expect(next.dirty).toBe(false);
  });

  it('clears any error', () => {
    const state: EditState = {
      mode: 'saving',
      original: 'old',
      draft: 'new',
      dirty: true,
      confirming: null,
      error: 'stale error',
    };
    const next = editReducer(state, { type: 'saveSuccess' });
    expect(next.error).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// saveError
// ---------------------------------------------------------------------------

describe('editReducer — saveError action', () => {
  it('returns to editing mode (not viewing — user should retry or cancel)', () => {
    const state: EditState = {
      mode: 'saving',
      original: 'original',
      draft: 'attempted value',
      dirty: true,
      confirming: null,
      error: null,
    };
    const next = editReducer(state, { type: 'saveError', message: 'Network error' });
    expect(next.mode).toBe('editing');
  });

  it('surfaces the error message', () => {
    const state: EditState = {
      mode: 'saving',
      original: 'original',
      draft: 'attempted',
      dirty: true,
      confirming: null,
      error: null,
    };
    const next = editReducer(state, { type: 'saveError', message: 'Network error' });
    expect(next.error).toBe('Network error');
  });

  it('preserves the draft so the user does not lose their work', () => {
    const state: EditState = {
      mode: 'saving',
      original: 'original',
      draft: 'attempted value',
      dirty: true,
      confirming: null,
      error: null,
    };
    const next = editReducer(state, { type: 'saveError', message: 'Oops' });
    expect(next.draft).toBe('attempted value');
  });

  it('preserves original (save failed, so original is unchanged)', () => {
    const state: EditState = {
      mode: 'saving',
      original: 'original',
      draft: 'attempted',
      dirty: true,
      confirming: null,
      error: null,
    };
    const next = editReducer(state, { type: 'saveError', message: 'Oops' });
    expect(next.original).toBe('original');
  });
});

// ---------------------------------------------------------------------------
// State-machine invariants
// ---------------------------------------------------------------------------

describe('editReducer — state-machine invariants', () => {
  it('reducer is a pure function — original state is not mutated', () => {
    const state = initialState('immutable value');
    const stateCopy = { ...state };
    editReducer(state, { type: 'enter' });
    expect(state).toEqual(stateCopy);
  });

  it('can do a full edit→save round-trip', () => {
    let s = initialState('initial');
    s = editReducer(s, { type: 'enter' });
    s = editReducer(s, { type: 'change', value: 'edited' });
    s = editReducer(s, { type: 'save' });
    s = editReducer(s, { type: 'saveSuccess' });
    expect(s.mode).toBe('viewing');
    expect(s.original).toBe('edited');
    expect(s.dirty).toBe(false);
  });

  it('can do a full edit→cancel round-trip (with dirty confirm)', () => {
    let s = initialState('initial');
    s = editReducer(s, { type: 'enter' });
    s = editReducer(s, { type: 'change', value: 'changed' });
    s = editReducer(s, { type: 'requestCancel' });
    expect(s.confirming).toBe('cancel');
    s = editReducer(s, { type: 'confirmCancel' });
    expect(s.mode).toBe('viewing');
    expect(s.original).toBe('initial'); // NOT 'changed'
    expect(s.draft).toBe('initial');
  });

  it('can do a full edit→clear→save round-trip', () => {
    let s = initialState('had content');
    s = editReducer(s, { type: 'enter' });
    s = editReducer(s, { type: 'requestClear' });
    s = editReducer(s, { type: 'confirmClear' });
    expect(s.draft).toBe('');
    expect(s.dirty).toBe(true);
    s = editReducer(s, { type: 'save' });
    s = editReducer(s, { type: 'saveSuccess' });
    expect(s.original).toBe('');
    expect(s.mode).toBe('viewing');
  });

  it('save→error→save→success full retry cycle', () => {
    let s = initialState('start');
    s = editReducer(s, { type: 'enter' });
    s = editReducer(s, { type: 'change', value: 'update' });
    s = editReducer(s, { type: 'save' });
    s = editReducer(s, { type: 'saveError', message: 'Timeout' });
    expect(s.mode).toBe('editing');
    expect(s.error).toBe('Timeout');
    s = editReducer(s, { type: 'save' });
    s = editReducer(s, { type: 'saveSuccess' });
    expect(s.mode).toBe('viewing');
    expect(s.original).toBe('update');
    expect(s.error).toBeNull();
  });
});
