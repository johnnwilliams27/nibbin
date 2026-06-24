'use client';
/**
 * Task 6 — AddSectionControl.tsx
 *
 * The "+ Add a section" affordance for the Grove Memory tab.
 * Renders ONLY in edit context (isEditing=true); view mode returns null.
 *
 * States:
 *  - idle (mode='idle'):   renders a "+ Add a section" button
 *  - adding (mode='adding'): renders an inline form with label input + Add/Cancel
 *
 * The component is purely presentational: it reads from `state` (from the
 * sectionControlsReducer) and dispatches actions upward. The `onIntent`
 * callback is called by the parent (MemoryClient) after consuming the
 * pending intent from the reducer.
 */

import React from 'react';
import type { SectionControlsState, SectionControlsAction, SectionControlsIntent } from './sectionControls.reducer';
import styles from './memory.module.css';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface AddSectionControlProps {
  state: SectionControlsState;
  dispatch: (action: SectionControlsAction) => void;
  /** Called when there is a pending intent to submit to the server. */
  onIntent: (intent: SectionControlsIntent) => Promise<void>;
  /** Whether the page is in edit mode (controls visible only when true). */
  isEditing: boolean;
}

// ---------------------------------------------------------------------------
// AddSectionControl — main export
// ---------------------------------------------------------------------------

export function AddSectionControl({
  state,
  dispatch,
  isEditing,
}: AddSectionControlProps): React.ReactElement | null {
  // View mode: render nothing
  if (!isEditing) return null;

  const { mode, addLabel, addError } = state;

  // ── Adding mode: inline form ──────────────────────────────────────────────
  if (mode === 'adding') {
    return (
      <div className={styles.addSectionForm}>
        <input
          type="text"
          className={styles.addSectionInput}
          value={addLabel}
          placeholder="Section label…"
          aria-label="New section label"
          onChange={(e) => dispatch({ type: 'EDIT_LABEL', label: e.target.value })}
        />
        {addError && (
          <p className={styles.addSectionError} role="alert">
            {addError}
          </p>
        )}
        <div className={styles.addSectionActions}>
          <button
            type="button"
            className={styles.primary}
            onClick={() => dispatch({ type: 'CONFIRM_ADD' })}
          >
            Add
          </button>
          <button
            type="button"
            className={styles.ghost}
            onClick={() => dispatch({ type: 'CANCEL' })}
          >
            Cancel
          </button>
        </div>
      </div>
    );
  }

  // ── Idle mode: the "+" affordance button ──────────────────────────────────
  return (
    <div className={styles.addSectionRow}>
      <button
        type="button"
        className={styles.addSectionBtn}
        onClick={() => dispatch({ type: 'START_ADD' })}
      >
        + Add a section
      </button>
    </div>
  );
}
