'use client';
/**
 * Task 7 — FieldEditor.tsx
 *
 * Presentational edit-mode component for a curated grove memory field.
 *
 * This component is a thin shell over the pure editReducer (fieldEditor.reducer.ts).
 * All interaction logic lives in the reducer — the component only:
 *   1. Renders the current state into markup
 *   2. Dispatches actions on user events
 *   3. Calls onSave (injected) when the user confirms a save, then dispatches
 *      saveSuccess / saveError based on the outcome
 *
 * Accessibility (§14):
 *   - Textarea carries autoFocus and aria-describedby pointing to the hint element
 *   - Inline confirmations render in an aria-live="assertive" region (not a modal)
 *   - All buttons have descriptive text; Clear uses a tertiary link style
 *
 * CSS: token-only via memory.module.css — new editor-specific classes
 *      (.fieldEditor, .fieldEditorHint, .fieldEditorActions, .fieldEditorError,
 *       .confirmRegion, .clearLink) follow the existing token discipline.
 */

import React, { useReducer, useRef } from 'react';
import { editReducer, initialState } from './fieldEditor.reducer';
import type { EditState, EditAction } from './fieldEditor.reducer';
import styles from './memory.module.css';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface FieldEditorProps {
  /** The field key (e.g. 'pricing', 'facts') — used for id namespacing. */
  fieldKey: string;
  /** Human-readable field label (for the Clear confirmation copy). */
  label: string;
  /** Optional hint shown above the textarea (from FIELD_CONFIG[key].hint). */
  hint?: string;
  /**
   * External state driving the component. When provided, the component renders
   * as a controlled/presentational component (used in tests via renderToStaticMarkup).
   * When omitted, the component manages its own internal useReducer state.
   */
  state?: EditState;
  /**
   * External dispatch (used when state is provided externally).
   * When omitted, the component uses its own internal dispatch.
   */
  dispatch?: (action: EditAction) => void;
  /** The current raw value (seeds internal reducer when no external state). */
  initialValue?: string;
  /**
   * Async save function injected from FieldBlock / MemoryClient.
   * Called with the current draft; should throw on failure.
   */
  onSave: (value: string) => Promise<void>;
}

// ---------------------------------------------------------------------------
// Inner render component (accepts fully resolved state + dispatch)
// ---------------------------------------------------------------------------

interface InnerProps {
  fieldKey: string;
  label: string;
  hint?: string;
  state: EditState;
  dispatch: (action: EditAction) => void;
  onSave: (value: string) => Promise<void>;
}

function FieldEditorInner({
  fieldKey,
  label,
  hint,
  state,
  dispatch,
  onSave,
}: InnerProps): React.ReactElement {
  const { mode, draft, confirming, error } = state;
  const isSaving = mode === 'saving';
  const hintId = hint ? `${fieldKey}-hint` : undefined;

  // Focus management: move focus to textarea when entering edit mode.
  // This is the 'use client' side — no-op in renderToStaticMarkup (SSR).
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Handle save dispatch: call onSave, then dispatch success/error.
  async function handleSave() {
    dispatch({ type: 'save' });
    try {
      await onSave(draft);
      dispatch({ type: 'saveSuccess' });
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Could not save. Please try again.';
      dispatch({ type: 'saveError', message });
    }
  }

  return (
    <div className={styles.fieldEditor}>
      {/* Hint (optional) */}
      {hint && (
        <p id={hintId} className={styles.fieldEditorHint}>
          {hint}
        </p>
      )}

      {/* Textarea */}
      <textarea
        ref={textareaRef}
        className={styles.textarea}
        value={draft}
        disabled={isSaving}
        autoFocus
        aria-describedby={hintId}
        rows={5}
        onChange={(e) => dispatch({ type: 'change', value: e.target.value })}
      />

      {/* Error message */}
      {error && (
        <p className={styles.fieldEditorError} role="alert">
          {error}
        </p>
      )}

      {/* Action row: Save + Cancel + Clear */}
      <div className={styles.fieldEditorActions}>
        <button
          type="button"
          className={styles.primary}
          disabled={isSaving}
          onClick={handleSave}
        >
          {isSaving ? 'Saving…' : 'Save'}
        </button>
        <button
          type="button"
          className={styles.ghost}
          disabled={isSaving}
          onClick={() => dispatch({ type: 'requestCancel' })}
        >
          Cancel
        </button>
        <button
          type="button"
          className={styles.clearLink}
          disabled={isSaving}
          onClick={() => dispatch({ type: 'requestClear' })}
        >
          Clear field
        </button>
      </div>

      {/* Inline confirmation region — aria-live so screen readers announce it.
          Rendered unconditionally as a live region; content appears/disappears.
          Motion: .confirmFade is applied to the prompt row so it fades in when
          it appears. Duration --dur-1 (~100ms) keeps it snappy. */}
      <div aria-live="assertive" className={styles.confirmRegion}>
        {confirming === 'cancel' && (
          <div className={`${styles.confirmPrompt} ${styles.confirmFade}`}>
            <span>Discard changes?</span>
            <button
              type="button"
              className={styles.confirmYes}
              onClick={() => dispatch({ type: 'confirmCancel' })}
            >
              Discard
            </button>
            <button
              type="button"
              className={styles.confirmNo}
              onClick={() => dispatch({ type: 'change', value: draft })}
            >
              Keep editing
            </button>
          </div>
        )}
        {confirming === 'clear' && (
          <div className={`${styles.confirmPrompt} ${styles.confirmFade}`}>
            <span>Clear {label}?</span>
            <button
              type="button"
              className={styles.confirmYes}
              onClick={() => dispatch({ type: 'confirmClear' })}
            >
              Clear
            </button>
            <button
              type="button"
              className={styles.confirmNo}
              onClick={() => dispatch({ type: 'change', value: draft })}
            >
              Keep it
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// FieldEditor — public export
//
// When `state` + `dispatch` are provided externally, renders as a pure
// presentational component (testable via renderToStaticMarkup).
// When neither is provided, manages its own useReducer state internally.
// ---------------------------------------------------------------------------

export function FieldEditor({
  fieldKey,
  label,
  hint,
  state: externalState,
  dispatch: externalDispatch,
  initialValue = '',
  onSave,
}: FieldEditorProps): React.ReactElement {
  // Internal state management (used at runtime, not in static-markup tests)
  const [internalState, internalDispatch] = useReducer(
    editReducer,
    initialValue,
    initialState,
  );

  const state = externalState ?? internalState;
  const dispatch = externalDispatch ?? internalDispatch;

  return (
    <FieldEditorInner
      fieldKey={fieldKey}
      label={label}
      hint={hint}
      state={state}
      dispatch={dispatch}
      onSave={onSave}
    />
  );
}
