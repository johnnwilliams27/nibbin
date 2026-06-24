/**
 * Task 6 — sectionControls.reducer.ts
 *
 * Pure state machine for the section add/rename/reorder/remove interactions.
 * No React, no DOM, no side effects.
 *
 * Modes:
 *  'idle'   — normal view; no add form open
 *  'adding' — "+ Add a section" form is open; addLabel tracks the input value
 *
 * Actions:
 *  START_ADD       — open the add form
 *  EDIT_LABEL      — update addLabel (keystroke in the add input)
 *  CONFIRM_ADD     — validate label non-empty → emit upsert_new intent, back to idle
 *                    if empty → set addError, stay in adding
 *  MOVE_UP/DOWN    — swap sort_order with adjacent sibling; emit upsert_pair intent
 *  CONFIRM_REMOVE  — for default keys: emit upsert_hide intent (is_hidden:true)
 *                    for custom keys (^c_): emit delete intent
 *  CANCEL          — back to idle, clear add form state + pending intent
 *  CLEAR_INTENT    — clear pendingIntent after the caller has submitted it
 *
 * Intent types (consumed by the component to call saveSectionMeta / deleteSection):
 *  upsert_hide  — call saveSectionMeta({ field_key, is_hidden: true })
 *  upsert_new   — call saveSectionMeta({ label, is_custom: true, sort_order })
 *  upsert_pair  — call saveSectionMeta twice (one per swapped section)
 *  delete       — call deleteSection({ field_key })
 */

import type { SectionDescriptor } from './registry';

// ---------------------------------------------------------------------------
// Intent types
// ---------------------------------------------------------------------------

export type UpsertHideIntent = {
  type: 'upsert_hide';
  key: string;
  isHidden: true;
};

export type UpsertNewIntent = {
  type: 'upsert_new';
  label: string;
  /** Sort order to assign: max existing sort_order + 100, or 1000 if none */
  sortOrder: number;
};

export type UpsertPairIntent = {
  type: 'upsert_pair';
  pairs: Array<{ key: string; sortOrder: number; isCustom: boolean }>;
};

export type DeleteIntent = {
  type: 'delete';
  key: string;
};

export type SectionControlsIntent =
  | UpsertHideIntent
  | UpsertNewIntent
  | UpsertPairIntent
  | DeleteIntent;

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

export interface SectionControlsState {
  /** The current ordered visible section list. Updated locally on moves. */
  sections: SectionDescriptor[];
  /** Interaction mode. */
  mode: 'idle' | 'adding';
  /** Label being typed into the add-section form. */
  addLabel: string;
  /** Validation error for the add form; cleared on EDIT_LABEL. */
  addError: string | null;
  /**
   * The pending intent to submit to the server.
   * The component should call the appropriate server action when this is set,
   * then dispatch CLEAR_INTENT.
   */
  pendingIntent: SectionControlsIntent | null;
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

export type SectionControlsAction =
  | { type: 'START_ADD' }
  | { type: 'EDIT_LABEL'; label: string }
  | { type: 'CONFIRM_ADD' }
  | { type: 'MOVE_UP'; key: string }
  | { type: 'MOVE_DOWN'; key: string }
  | { type: 'CONFIRM_REMOVE'; key: string }
  | { type: 'CANCEL' }
  | { type: 'CLEAR_INTENT' };

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** A custom section key starts with 'c_'. */
function isCustomKey(key: string): boolean {
  return /^c_/.test(key);
}

/** Compute the next sort_order for a new section: max existing + 100. */
function nextSortOrder(sections: SectionDescriptor[]): number {
  if (sections.length === 0) return 1000;
  const max = Math.max(...sections.map((s) => s.sortOrder));
  return max + 100;
}

// ---------------------------------------------------------------------------
// initialSectionControlsState
// ---------------------------------------------------------------------------

export function initialSectionControlsState(sections: SectionDescriptor[]): SectionControlsState {
  return {
    sections: [...sections],
    mode: 'idle',
    addLabel: '',
    addError: null,
    pendingIntent: null,
  };
}

// ---------------------------------------------------------------------------
// Reducer
// ---------------------------------------------------------------------------

export function sectionControlsReducer(
  state: SectionControlsState,
  action: SectionControlsAction,
): SectionControlsState {
  switch (action.type) {
    case 'START_ADD': {
      return {
        ...state,
        mode: 'adding',
        addLabel: '',
        addError: null,
      };
    }

    case 'EDIT_LABEL': {
      return {
        ...state,
        addLabel: action.label,
        addError: null,
      };
    }

    case 'CONFIRM_ADD': {
      const trimmed = state.addLabel.trim();
      if (!trimmed) {
        return {
          ...state,
          addError: 'Section label cannot be empty.',
        };
      }
      const sortOrder = nextSortOrder(state.sections);
      return {
        ...state,
        mode: 'idle',
        addLabel: '',
        addError: null,
        pendingIntent: {
          type: 'upsert_new',
          label: trimmed,
          sortOrder,
        },
      };
    }

    case 'MOVE_UP': {
      const sections = [...state.sections];
      const idx = sections.findIndex((s) => s.key === action.key);
      if (idx <= 0) {
        // First item or not found — no-op
        return state;
      }
      const prev = sections[idx - 1];
      const curr = sections[idx];

      // Swap sort_order values, but ensure they are distinct even when equal.
      // When both share the same sort_order the naive swap is a no-op, so we
      // normalise: assign index-based orders to the affected pair so the move
      // is always visible.
      let prevNewOrder = curr.sortOrder;
      let currNewOrder = prev.sortOrder;
      if (prevNewOrder === currNewOrder) {
        // Assign index-proportional values to guarantee a distinct ordering.
        prevNewOrder = (idx - 1) * 100 + 100;
        currNewOrder = prevNewOrder - 100;
      }

      const newSections = sections.map((s) => {
        if (s.key === prev.key) return { ...s, sortOrder: prevNewOrder };
        if (s.key === curr.key) return { ...s, sortOrder: currNewOrder };
        return s;
      });

      // Re-sort after swap
      newSections.sort((a, b) => a.sortOrder - b.sortOrder);

      return {
        ...state,
        sections: newSections,
        pendingIntent: {
          type: 'upsert_pair',
          pairs: [
            { key: prev.key, sortOrder: prevNewOrder, isCustom: prev.isCustom ?? false },
            { key: curr.key, sortOrder: currNewOrder, isCustom: curr.isCustom ?? false },
          ],
        },
      };
    }

    case 'MOVE_DOWN': {
      const sections = [...state.sections];
      const idx = sections.findIndex((s) => s.key === action.key);
      if (idx < 0 || idx >= sections.length - 1) {
        // Last item or not found — no-op
        return state;
      }
      const curr = sections[idx];
      const next = sections[idx + 1];

      // Swap sort_order values, but ensure they are distinct even when equal.
      // When both share the same sort_order the naive swap is a no-op, so we
      // normalise: assign index-based orders to the affected pair so the move
      // is always visible.
      let currNewOrder = next.sortOrder;
      let nextNewOrder = curr.sortOrder;
      if (currNewOrder === nextNewOrder) {
        // Assign index-proportional values to guarantee a distinct ordering.
        nextNewOrder = (idx + 1) * 100 + 100;
        currNewOrder = nextNewOrder - 100;
      }

      const newSections = sections.map((s) => {
        if (s.key === curr.key) return { ...s, sortOrder: currNewOrder };
        if (s.key === next.key) return { ...s, sortOrder: nextNewOrder };
        return s;
      });

      // Re-sort after swap
      newSections.sort((a, b) => a.sortOrder - b.sortOrder);

      return {
        ...state,
        sections: newSections,
        pendingIntent: {
          type: 'upsert_pair',
          pairs: [
            { key: curr.key, sortOrder: currNewOrder, isCustom: curr.isCustom ?? false },
            { key: next.key, sortOrder: nextNewOrder, isCustom: next.isCustom ?? false },
          ],
        },
      };
    }

    case 'CONFIRM_REMOVE': {
      const key = action.key;
      if (isCustomKey(key)) {
        // Custom section: delete it entirely
        return {
          ...state,
          mode: 'idle',
          pendingIntent: {
            type: 'delete',
            key,
          },
        };
      } else {
        // Default section: hide it via upsert
        return {
          ...state,
          mode: 'idle',
          pendingIntent: {
            type: 'upsert_hide',
            key,
            isHidden: true,
          },
        };
      }
    }

    case 'CANCEL': {
      return {
        ...state,
        mode: 'idle',
        addLabel: '',
        addError: null,
        pendingIntent: null,
      };
    }

    case 'CLEAR_INTENT': {
      return {
        ...state,
        pendingIntent: null,
      };
    }

    default: {
      void (action as never);
      return state;
    }
  }
}
