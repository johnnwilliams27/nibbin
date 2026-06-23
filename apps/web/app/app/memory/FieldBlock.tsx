'use client';
/**
 * Task 8 — FieldBlock.tsx
 *
 * Composite view/edit toggle for a single curated grove memory field.
 *
 * Responsibilities:
 *   1. Toggles between FieldView (locked/display) and FieldEditor (edit) mode.
 *   2. Owns local `mode`/`localValue` state via useState.
 *   3. Wires the FieldEditor's reducer (via editReducer) for interaction logic.
 *   4. Calls `onSave(field, value)` up to MemoryClient on save.
 *   5. Renders a fixed-height provenance slot (F1-gated, graceful-empty pre-F1).
 *      The slot is always rendered so layout does not shift when data arrives;
 *      it is silent (empty) pre-F1 — no fabricated text, no "unknown".
 *
 * Focus-on-enter: when the toggle opens the editor, the textarea's autoFocus
 * attribute handles initial focus (FieldEditor renders with autoFocus).
 *
 * Testing contract:
 *   - `testMode` prop bypasses internal useState so renderToStaticMarkup tests
 *     can drive 'view' or 'edit' state directly without DOM/click simulation.
 *   - When `testMode` is omitted, the component manages state via useState.
 *
 * Provenance slot:
 *   - Always rendered as a fixed-height `.provenanceSlot` element.
 *   - Empty and silent when `fieldMeta` is not provided (pre-F1).
 *   - When `fieldMeta` is provided, renders the source label + staleness line.
 *   - Staleness threshold: 60 days (STALE_DAYS). Stale → "worth a check?" copy.
 *
 * CSS: `.fieldBlock`, `.fieldHeader`, `.fieldLabel`, `.editBtn`, `.provenanceSlot`,
 *      `.provenanceLine`, `.provenanceStale` — all token-only, added to memory.module.css.
 */

import React, { useState, useEffect, useRef } from 'react';
import { FieldView } from './FieldView';
import { FieldEditor } from './FieldEditor';
import { editReducer, initialState } from './fieldEditor.reducer';
import { formatField } from './format';
import { FIELD_CONFIG } from './fields';
import { sourceLabel, staleness } from './provenance';
import type { FieldMeta } from './provenance';
import styles from './memory.module.css';

// Re-export FieldMeta so existing test imports (`import type { FieldMeta } from './FieldBlock'`)
// continue to resolve without modification.
export type { FieldMeta };

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface FieldBlockProps {
  /** The field key (e.g. 'pricing', 'facts'). */
  fieldKey: string;
  /** Human-readable field label shown in the header. */
  label: string;
  /** Current raw text value from the grove_memory mirror. */
  rawValue: string;
  /**
   * Async save handler injected from MemoryClient.
   * Receives (fieldKey, newValue) — MemoryClient merges and calls saveGroveMemory.
   */
  onSave: (fieldKey: string, value: string) => Promise<void>;
  /**
   * F1 provenance metadata for this field.
   * When undefined: provenance slot is reserved but empty (silent pre-F1).
   * When provided: source label + staleness line is rendered.
   */
  fieldMeta?: FieldMeta;
  /**
   * Test-mode override: 'view' | 'edit' bypasses internal useState so
   * renderToStaticMarkup tests can drive state directly.
   * At runtime, leave this undefined — the component manages state internally.
   */
  testMode?: 'view' | 'edit';
}

// ---------------------------------------------------------------------------
// Provenance slot renderer
// ---------------------------------------------------------------------------

interface ProvenanceSlotProps {
  fieldMeta?: FieldMeta;
}

function ProvenanceSlot({ fieldMeta }: ProvenanceSlotProps): React.ReactElement {
  // The slot is always rendered at a fixed minimum height to prevent layout shift.
  // Pre-F1 (no fieldMeta): silent empty — no text rendered, no "unknown".
  // Post-F1 (fieldMeta present): source label + optional staleness indicator.

  if (!fieldMeta) {
    return <div className={styles.provenanceSlot} aria-hidden="true" />;
  }

  const label = sourceLabel(fieldMeta.source);
  if (!label) {
    // Unknown source → still silent (rule: null → no text, §226)
    return <div className={styles.provenanceSlot} aria-hidden="true" />;
  }

  const { stale, text: staleText } = staleness(fieldMeta.lastReviewedAt);

  return (
    <div className={styles.provenanceSlot}>
      <span className={stale ? styles.provenanceStale : styles.provenanceLine}>
        {label}
        {stale && staleText ? ` ${staleText}` : ''}
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// FieldBlock — main export
// ---------------------------------------------------------------------------

export function FieldBlock({
  fieldKey,
  label,
  rawValue,
  onSave,
  fieldMeta,
  testMode,
}: FieldBlockProps): React.ReactElement {
  // Internal mode state — bypassed when testMode is set (for static tests).
  const [internalMode, setInternalMode] = useState<'view' | 'edit'>('view');
  const [localValue, setLocalValue] = useState(rawValue);

  // Ref to the Edit button so focus can return after editing closes.
  const editBtnRef = useRef<HTMLButtonElement>(null);

  // Resolve effective mode: test override wins when set.
  const mode = testMode ?? internalMode;

  // The field config drives formatting and placeholder.
  const config = FIELD_CONFIG[fieldKey];
  const placeholder = config?.placeholder ?? '';
  const hint = config?.hint;

  // Format the current local value for FieldView.
  const kind = config?.kind ?? 'paragraphs';
  // 'list' is handled by formatField as a list kind.
  const descriptor = formatField(kind as Parameters<typeof formatField>[0], localValue);

  // --- External state/dispatch pattern (Task 7's FieldEditor supports this) ---
  //
  // FieldBlock owns the EditState so it can observe mode transitions:
  // when editorState.mode becomes 'viewing' (cancel or saveSuccess confirmed),
  // FieldBlock switches back to its own view mode. This avoids modifying the
  // Task 7 FieldEditor interface.
  //
  // Use the external state/dispatch pattern from Task 7's FieldEditor:
  // FieldBlock owns the EditState so it can observe mode transitions.
  const [editorState, editorDispatch] = React.useReducer(
    editReducer,
    localValue,
    initialState,
  );

  // When editorState.mode transitions to 'viewing' (cancel or saveSuccess),
  // and we're in edit mode, switch back to view mode.
  // We use useEffect here which is a no-op in renderToStaticMarkup (SSR).
  useEffect(() => {
    if (testMode) return; // don't fire in test mode
    if (internalMode === 'edit' && editorState.mode === 'viewing') {
      setInternalMode('view');
      // Return focus to Edit button
      setTimeout(() => editBtnRef.current?.focus(), 0);
    }
  }, [editorState.mode, internalMode, testMode]);

  // Also re-seed the editor state when entering edit mode
  // (so it always reflects the current localValue).
  // Since editReducer is called with 'enter' action when edit button clicked:
  function handleEditClickWithReducer() {
    editorDispatch({ type: 'enter' });
    setInternalMode('edit');
  }

  // Wrap the save: call the parent, then dispatch saveSuccess/saveError.
  async function handleEditorSave(value: string): Promise<void> {
    // Note: FieldEditor dispatches 'save' → calls this → we call parent.
    // On success, FieldEditor dispatches 'saveSuccess' which sets its mode to 'viewing'.
    // Our useEffect above will then set internalMode back to 'view'.
    await onSave(fieldKey, value);
    setLocalValue(value);
    // Focus return handled by useEffect after mode transition
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <div className={styles.fieldBlock}>
      {/* Field header: label + Edit button (view mode only) */}
      <div className={styles.fieldHeader}>
        <span className={styles.fieldLabel}>{label}</span>
        {mode === 'view' && (
          <button
            ref={editBtnRef}
            type="button"
            className={styles.editBtn}
            aria-label={`Edit ${label}`}
            onClick={testMode ? undefined : handleEditClickWithReducer}
          >
            Edit
          </button>
        )}
      </div>

      {/* Content area: switches between FieldView and FieldEditor */}
      {mode === 'view' ? (
        <div className={styles.fieldView}>
          <FieldView descriptor={descriptor} placeholder={placeholder} />
        </div>
      ) : (
        <FieldEditor
          fieldKey={fieldKey}
          label={label}
          hint={hint}
          state={editorState}
          dispatch={editorDispatch}
          initialValue={localValue}
          onSave={handleEditorSave}
        />
      )}

      {/* Provenance slot: always rendered, empty pre-F1 (§11 / §226) */}
      <ProvenanceSlot fieldMeta={fieldMeta} />
    </div>
  );
}
