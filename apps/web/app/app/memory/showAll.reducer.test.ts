/**
 * Task 14 — showAll.reducer.test.ts
 *
 * Pure function tests for the Show-all toggle reducer.
 * No DOM, no jsdom — logic only.
 *
 * Covers:
 *  - initialShowAllState: starts collapsed
 *  - toggle: flips true→false, false→true
 *  - expand: always true, idempotent
 *  - collapse: always false, idempotent
 */

import { describe, it, expect } from 'vitest';
import {
  showAllReducer,
  initialShowAllState,
} from './showAll.reducer';

// ---------------------------------------------------------------------------
// Initial state
// ---------------------------------------------------------------------------

describe('showAllReducer — initial state', () => {
  it('starts collapsed (false)', () => {
    expect(initialShowAllState).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// toggle action
// ---------------------------------------------------------------------------

describe('showAllReducer — toggle', () => {
  it('flips false → true', () => {
    expect(showAllReducer(false, 'toggle')).toBe(true);
  });

  it('flips true → false', () => {
    expect(showAllReducer(true, 'toggle')).toBe(false);
  });

  it('double-toggle returns to original state', () => {
    const state0 = initialShowAllState;
    const state1 = showAllReducer(state0, 'toggle');
    const state2 = showAllReducer(state1, 'toggle');
    expect(state2).toBe(state0);
  });
});

// ---------------------------------------------------------------------------
// expand action
// ---------------------------------------------------------------------------

describe('showAllReducer — expand', () => {
  it('sets state to true from false', () => {
    expect(showAllReducer(false, 'expand')).toBe(true);
  });

  it('is idempotent when already expanded', () => {
    expect(showAllReducer(true, 'expand')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// collapse action
// ---------------------------------------------------------------------------

describe('showAllReducer — collapse', () => {
  it('sets state to false from true', () => {
    expect(showAllReducer(true, 'collapse')).toBe(false);
  });

  it('is idempotent when already collapsed', () => {
    expect(showAllReducer(false, 'collapse')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Toggle sequence (integration)
// ---------------------------------------------------------------------------

describe('showAllReducer — toggle sequence', () => {
  it('collapsed → toggle → expanded → toggle → collapsed', () => {
    let state = initialShowAllState; // false
    state = showAllReducer(state, 'toggle'); // true
    expect(state).toBe(true);
    state = showAllReducer(state, 'toggle'); // false
    expect(state).toBe(false);
  });

  it('expand then collapse returns to collapsed', () => {
    let state = showAllReducer(initialShowAllState, 'expand');
    expect(state).toBe(true);
    state = showAllReducer(state, 'collapse');
    expect(state).toBe(false);
  });
});
