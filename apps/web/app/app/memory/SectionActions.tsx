'use client';
/**
 * Task 6 — SectionActions.tsx
 *
 * Per-section affordances for rename/reorder/remove in edit mode.
 * Renders ONLY in edit context (isEditing=true); view mode returns null.
 *
 * Controls rendered per section:
 *  - Move up   (disabled for the first section)
 *  - Move down (disabled for the last section)
 *  - Remove    (for default sections: hides via upsert; for custom: deletes)
 *
 * Dispatches directly to the sectionControlsReducer. The parent (MemoryClient)
 * is responsible for observing pendingIntent and calling the server actions.
 */

import React from 'react';
import type { SectionControlsAction, SectionControlsIntent } from './sectionControls.reducer';
import type { SectionDescriptor } from './registry';
import styles from './memory.module.css';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface SectionActionsProps {
  /** The section this affordance set belongs to. */
  section: SectionDescriptor;
  /** The full ordered visible section list (for first/last position checks). */
  allSections: SectionDescriptor[];
  dispatch: (action: SectionControlsAction) => void;
  /** Called when there is a pending intent to submit (passed from parent). */
  onIntent: (intent: SectionControlsIntent) => Promise<void>;
  /** Whether the page is in edit mode (controls visible only when true). */
  isEditing: boolean;
}

// ---------------------------------------------------------------------------
// SectionActions — main export
// ---------------------------------------------------------------------------

export function SectionActions({
  section,
  allSections,
  dispatch,
  isEditing,
}: SectionActionsProps): React.ReactElement | null {
  // View mode: render nothing
  if (!isEditing) return null;

  const idx = allSections.findIndex((s) => s.key === section.key);
  const isFirst = idx === 0;
  const isLast = idx === allSections.length - 1;

  // Label for the remove button: default sections are "hidden" (reversible),
  // custom sections are deleted permanently.
  const isCustom = section.isCustom ?? false;
  const removeLabel = isCustom ? 'Remove' : 'Hide';

  return (
    <div className={styles.sectionActions}>
      {/* Move up */}
      <button
        type="button"
        className={styles.sectionMoveBtn}
        aria-label={`Move ${section.label} up`}
        disabled={isFirst}
        onClick={() => dispatch({ type: 'MOVE_UP', key: section.key })}
      >
        ↑ Move up
      </button>

      {/* Move down */}
      <button
        type="button"
        className={styles.sectionMoveBtn}
        aria-label={`Move ${section.label} down`}
        disabled={isLast}
        onClick={() => dispatch({ type: 'MOVE_DOWN', key: section.key })}
      >
        ↓ Move down
      </button>

      {/* Remove / Hide */}
      <button
        type="button"
        className={styles.sectionRemoveBtn}
        aria-label={`${removeLabel} ${section.label}`}
        onClick={() => dispatch({ type: 'CONFIRM_REMOVE', key: section.key })}
      >
        {removeLabel}
      </button>
    </div>
  );
}
