'use client';
/**
 * Task 13 — ReferenceCatchAll.tsx
 *
 * The Sources-tab freeform catch-all for raw reference material.
 *
 * Distinct from the curated `notes` field on the Grove Memory truth tab:
 *  - `notes`          = short curated aside, structurally formatted, in sections JSONB
 *  - `reference_text` = long raw dump, rendered as <pre>, stored in its own column
 *
 * Deliberate edit pattern (same as curated fields):
 *  - View mode by default: value rendered as <pre>, Edit button present
 *  - Edit mode: <textarea> with Save / Cancel / Clear field buttons
 *  - No structural formatting (no list/dl/quote parsing) — §8.1
 *
 * The "Show all / Collapse" affordance is rendered statically in view mode when
 * the value exceeds SHOW_ALL_THRESHOLD characters (interactive toggle is Task 14).
 *
 * Testing contract:
 *  - `testMode` prop bypasses internal useState so renderToStaticMarkup tests
 *    can drive 'view' or 'edit' state directly without DOM/click simulation.
 *  - When `testMode` is omitted, the component manages state via useState.
 *
 * CSS: adds `.referenceBlock`, `.referenceHeader`, `.referenceLabel`,
 *      `.referencePre`, `.referencePreWrap`, `.referenceEmpty`,
 *      `.referenceShowAll` to memory.module.css.
 */

import React, { useState, useReducer, useRef, useEffect } from 'react';
import { editReducer, initialState } from './fieldEditor.reducer';
import styles from './memory.module.css';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Characters beyond which the "Show all" affordance appears in view mode. */
const SHOW_ALL_THRESHOLD = 500;

/** Nudge copy shown when reference_text is empty (§14.5). */
const EMPTY_NUDGE =
  "Don't want to type it all out? Drop in a doc, a voice memo transcript, or a messy brain dump — anything that gives your Nibbins more context to work with.";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface ReferenceCatchAllProps {
  /** Current reference_text value from the grove_memory row. */
  value: string;
  /**
   * Save handler. Called with the new raw string; the caller builds FormData
   * and calls saveReference. Returns a promise; should throw on failure.
   */
  onSave: (value: string) => Promise<void>;
  /**
   * Test-mode override: 'view' | 'edit' bypasses internal useState so
   * renderToStaticMarkup tests can drive state directly.
   * At runtime, leave this undefined — the component manages state internally.
   */
  testMode?: 'view' | 'edit';
}

// ---------------------------------------------------------------------------
// ReferenceCatchAll — main export
// ---------------------------------------------------------------------------

export function ReferenceCatchAll({
  value,
  onSave,
  testMode,
}: ReferenceCatchAllProps): React.ReactElement {
  // ---------------------------------------------------------------------------
  // State
  // ---------------------------------------------------------------------------

  // Internal mode state — bypassed when testMode is set.
  const [internalMode, setInternalMode] = useState<'view' | 'edit'>('view');
  const mode = testMode ?? internalMode;

  // Keep the displayed/editable value in a local mirror.
  const [localValue, setLocalValue] = useState(value);

  // Ref to the Edit button so focus can return after editing closes.
  const editBtnRef = useRef<HTMLButtonElement>(null);

  // Reducer for editor interaction state (reuses the Task 7 reducer).
  const [editorState, editorDispatch] = useReducer(editReducer, localValue, initialState);

  // When editorState.mode transitions to 'viewing' (cancel or saveSuccess),
  // switch back to view mode and return focus to Edit button.
  useEffect(() => {
    if (testMode) return; // no-op in test mode
    if (internalMode === 'edit' && editorState.mode === 'viewing') {
      setInternalMode('view');
      setTimeout(() => editBtnRef.current?.focus(), 0);
    }
  }, [editorState.mode, internalMode, testMode]);

  // ---------------------------------------------------------------------------
  // Event handlers
  // ---------------------------------------------------------------------------

  function handleEditClick() {
    editorDispatch({ type: 'enter' });
    setInternalMode('edit');
  }

  async function handleSave(draft: string): Promise<void> {
    try {
      await onSave(draft);
      setLocalValue(draft);
      editorDispatch({ type: 'saveSuccess' });
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Could not save. Please try again.';
      editorDispatch({ type: 'saveError', message });
    }
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  const isLong = localValue.length > SHOW_ALL_THRESHOLD;
  const isEmpty = localValue.trim() === '';

  return (
    <div className={styles.referenceBlock}>
      {/* Header: label + Edit button (view mode only) */}
      <div className={styles.referenceHeader}>
        <span className={styles.referenceLabel}>Reference material</span>
        {mode === 'view' && (
          <button
            ref={editBtnRef}
            type="button"
            className={styles.editBtn}
            aria-label="Edit Reference material"
            onClick={testMode ? undefined : handleEditClick}
          >
            Edit
          </button>
        )}
      </div>

      {/* Content area: view mode vs edit mode */}
      {mode === 'view' ? (
        <>
          {isEmpty ? (
            /* Empty nudge copy (§14.5) */
            <p className={styles.referenceEmpty}>{EMPTY_NUDGE}</p>
          ) : (
            /* Value rendered as <pre> — no structural formatting (§8.1) */
            <div className={styles.referencePreWrap}>
              <pre className={styles.referencePre}>{localValue}</pre>
              {isLong && (
                <button
                  type="button"
                  className={styles.referenceShowAll}
                  aria-expanded="false"
                  onClick={undefined /* Task 14 wires this toggle */}
                >
                  Show all
                </button>
              )}
            </div>
          )}
        </>
      ) : (
        /* Edit mode: textarea + Save / Cancel / Clear field */
        <ReferenceEditor
          editorState={editorState}
          editorDispatch={editorDispatch}
          onSave={handleSave}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// ReferenceEditor — edit-mode inner component
// ---------------------------------------------------------------------------

import type { EditState, EditAction } from './fieldEditor.reducer';

interface ReferenceEditorProps {
  editorState: EditState;
  editorDispatch: (action: EditAction) => void;
  onSave: (value: string) => Promise<void>;
}

function ReferenceEditor({
  editorState,
  editorDispatch,
  onSave,
}: ReferenceEditorProps): React.ReactElement {
  const { draft, mode, confirming, error } = editorState;
  const isSaving = mode === 'saving';

  async function handleSaveClick() {
    editorDispatch({ type: 'save' });
    await onSave(draft);
  }

  return (
    <div className={styles.fieldEditor}>
      {/* Textarea — freeform long-form, no structural formatting */}
      <textarea
        className={styles.textarea}
        value={draft}
        disabled={isSaving}
        autoFocus
        rows={8}
        onChange={(e) => editorDispatch({ type: 'change', value: e.target.value })}
      />

      {/* Error message */}
      {error && (
        <p className={styles.fieldEditorError} role="alert">
          {error}
        </p>
      )}

      {/* Action row: Save + Cancel + Clear field */}
      <div className={styles.fieldEditorActions}>
        <button
          type="button"
          className={styles.primary}
          disabled={isSaving}
          onClick={handleSaveClick}
        >
          {isSaving ? 'Saving…' : 'Save'}
        </button>
        <button
          type="button"
          className={styles.ghost}
          disabled={isSaving}
          onClick={() => editorDispatch({ type: 'requestCancel' })}
        >
          Cancel
        </button>
        <button
          type="button"
          className={styles.clearLink}
          disabled={isSaving}
          onClick={() => editorDispatch({ type: 'requestClear' })}
        >
          Clear field
        </button>
      </div>

      {/* Inline confirmation region */}
      <div aria-live="assertive" className={styles.confirmRegion}>
        {confirming === 'cancel' && (
          <div className={styles.confirmPrompt}>
            <span>Discard changes?</span>
            <button
              type="button"
              className={styles.confirmYes}
              onClick={() => editorDispatch({ type: 'confirmCancel' })}
            >
              Discard
            </button>
            <button
              type="button"
              className={styles.confirmNo}
              onClick={() => editorDispatch({ type: 'change', value: draft })}
            >
              Keep editing
            </button>
          </div>
        )}
        {confirming === 'clear' && (
          <div className={styles.confirmPrompt}>
            <span>Clear Reference material?</span>
            <button
              type="button"
              className={styles.confirmYes}
              onClick={() => editorDispatch({ type: 'confirmClear' })}
            >
              Clear
            </button>
            <button
              type="button"
              className={styles.confirmNo}
              onClick={() => editorDispatch({ type: 'change', value: draft })}
            >
              Keep it
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
