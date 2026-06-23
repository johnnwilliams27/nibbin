/**
 * Task 7 — fieldEditor.reducer.ts
 *
 * Pure reducer for the FieldEditor interaction state machine.
 * No React, no DOM, no side effects — the save call is injected at the
 * component level and dispatched from outside the reducer.
 *
 * Modes:
 *  'viewing'  — read-only; Edit button visible
 *  'editing'  — textarea active; Save / Cancel buttons visible
 *  'saving'   — async save in flight; inputs disabled
 *
 * Confirming:
 *  null     — no confirmation prompt showing
 *  'cancel' — "Discard changes?" inline prompt (only when dirty)
 *  'clear'  — "Clear [field]?" inline prompt (always explicit)
 *
 * Cancel-without-dirty exits immediately to 'viewing' (no confirm step).
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type EditMode = 'viewing' | 'editing' | 'saving';
export type ConfirmKind = 'cancel' | 'clear' | null;

export interface EditState {
  /** Current interaction mode. */
  mode: EditMode;
  /** The last-saved (or initial) value. Cancel reverts to this. */
  original: string;
  /** Live textarea value while editing. */
  draft: string;
  /** True when draft !== original. */
  dirty: boolean;
  /** Which inline confirmation is pending, if any. */
  confirming: ConfirmKind;
  /** Error message from a failed save, cleared on next save/enter/cancel. */
  error: string | null;
}

export type EditAction =
  | { type: 'enter' }
  | { type: 'change'; value: string }
  | { type: 'requestCancel' }
  | { type: 'confirmCancel' }
  | { type: 'requestClear' }
  | { type: 'confirmClear' }
  | { type: 'save' }
  | { type: 'saveSuccess' }
  | { type: 'saveError'; message: string };

// ---------------------------------------------------------------------------
// initialState factory
// ---------------------------------------------------------------------------

/**
 * Build the initial state for a field editor with the given current value.
 * Always starts in 'viewing' mode.
 */
export function initialState(value: string): EditState {
  return {
    mode: 'viewing',
    original: value,
    draft: value,
    dirty: false,
    confirming: null,
    error: null,
  };
}

// ---------------------------------------------------------------------------
// Reducer
// ---------------------------------------------------------------------------

/**
 * Pure reducer: (state, action) → next state.
 * Does not mutate the input state. All transitions are explicit.
 */
export function editReducer(state: EditState, action: EditAction): EditState {
  switch (action.type) {
    case 'enter': {
      // Enter edit mode. Draft is set to current original value.
      // Clears any previous error so the user starts fresh.
      return {
        ...state,
        mode: 'editing',
        draft: state.original,
        dirty: false,
        confirming: null,
        error: null,
      };
    }

    case 'change': {
      // User typed in the textarea. Update draft, recalculate dirty.
      // Dismiss any pending confirmation (typing = user changed their mind).
      return {
        ...state,
        draft: action.value,
        dirty: action.value !== state.original,
        confirming: null,
      };
    }

    case 'requestCancel': {
      // User clicked Cancel.
      // If clean: exit immediately — no reason to confirm discarding nothing.
      // If dirty: show the "Discard changes?" inline prompt.
      if (!state.dirty) {
        return {
          ...state,
          mode: 'viewing',
          draft: state.original,
          confirming: null,
          error: null,
        };
      }
      return {
        ...state,
        confirming: 'cancel',
      };
    }

    case 'confirmCancel': {
      // User confirmed they want to discard changes.
      // Revert draft to original, exit to viewing.
      return {
        ...state,
        mode: 'viewing',
        draft: state.original,
        dirty: false,
        confirming: null,
        error: null,
      };
    }

    case 'requestClear': {
      // User clicked the "Clear field" tertiary link.
      // Always requires explicit confirmation — even if the draft is already empty.
      return {
        ...state,
        confirming: 'clear',
      };
    }

    case 'confirmClear': {
      // User confirmed clearing the field.
      // Sets draft to '' and marks dirty (the clear is a pending change, not yet saved).
      // Stays in editing mode — user must Save to persist.
      return {
        ...state,
        draft: '',
        dirty: true,
        confirming: null,
      };
    }

    case 'save': {
      // Async save initiated. Disable inputs, clear any previous error.
      return {
        ...state,
        mode: 'saving',
        confirming: null,
        error: null,
      };
    }

    case 'saveSuccess': {
      // Save completed. Promote draft to original, exit to viewing.
      return {
        ...state,
        mode: 'viewing',
        original: state.draft,
        dirty: false,
        confirming: null,
        error: null,
      };
    }

    case 'saveError': {
      // Save failed. Return to editing so the user can retry or cancel.
      // Preserve the draft (never lose work on a failed save).
      return {
        ...state,
        mode: 'editing',
        error: action.message,
      };
    }

    default: {
      // Exhaustiveness check — TypeScript will error if a case is missing.
      void (action as never);
      return state;
    }
  }
}
