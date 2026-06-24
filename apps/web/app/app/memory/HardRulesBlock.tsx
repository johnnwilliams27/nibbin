'use client';
/**
 * Task 9 — HardRulesBlock.tsx
 *
 * The hard-rules field with the coral AUTHORITY treatment (§7).
 *
 * Coral here is NOT an error signal — it is a visual marker that these rules
 * are gospel: non-negotiable commitments that your Nibbins will never violate.
 * The coral left border + coral-deep eyebrow + coral-deep bullet squares
 * combine to visually separate this field from the rest of the memory surface.
 *
 * Design tokens used (no raw hex values):
 *  - `--coral-soft`  → left border (soft authority accent)
 *  - `--coral-deep`  → eyebrow text + bullet squares (high-contrast authority ink)
 *
 * View mode:
 *  - "HARD RULES" mono eyebrow in coral-deep
 *  - "Your Nibbins never break these" sub-label in ink-soft
 *  - Each rule as <li> with coral-square bullet (::before pseudo, via .ruleBullet)
 *  - Empty → "No hard rules yet" faint placeholder
 *  - Edit button (ghost, moss-deep, matching FieldBlock.editBtn pattern)
 *
 * Edit mode:
 *  - Reuses FieldEditor directly (single textarea, one rule per line)
 *  - Hint: "Your Nibbins never break these. One rule per line."
 *  - Coral container class preserved — the authority context is always visible
 *  - Save / Cancel / Clear field from FieldEditor (no re-implementation)
 *
 * Save path:
 *  - onSave('hard_rules', rawString) called with the rules joined by '\n'
 *  - MemoryClient's mirror merge + toRpcPayload split on '\n' for the RPC
 *
 * Testing contract:
 *  - `testMode` prop bypasses internal useState (same pattern as FieldBlock)
 *  - Pure helpers `rulesArrayToString` / `rulesStringToArray` are exported
 *    so tests can assert round-trip correctness without DOM.
 *
 * CSS: `.hardRules`, `.hardRulesHeader`, `.hardRulesLabels`, `.hardRulesEyebrow`,
 *      `.hardRulesSubLabel`, `.ruleList`, `.ruleBullet`, `.hardRulesEmpty`,
 *      `.hardRulesEditor`, `.hardRulesHint` — all token-only in memory.module.css.
 */

import React, { useState, useEffect, useRef, useReducer } from 'react';
import { FieldEditor } from './FieldEditor';
import { editReducer, initialState } from './fieldEditor.reducer';
import styles from './memory.module.css';

// ---------------------------------------------------------------------------
// Pure helpers (exported for unit tests)
// ---------------------------------------------------------------------------

/**
 * Joins a rules array into a single newline-separated string for the textarea.
 * Empty array → empty string.
 */
export function rulesArrayToString(rules: string[]): string {
  return rules.join('\n');
}

/**
 * Splits a newline-separated string into a rules array.
 * Trims each line; filters blank lines.
 * Empty / whitespace-only string → [].
 */
export function rulesStringToArray(raw: string): string[] {
  return raw
    .split('\n')
    .map((r) => r.trim())
    .filter(Boolean);
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface HardRulesBlockProps {
  /**
   * The current rules array from grove_memory.hard_rules.
   * The component converts to/from a newline-separated string for editing.
   */
  rules: string[];
  /**
   * Async save handler injected from MemoryClient.
   * Receives ('hard_rules', rawNewlineString) — MemoryClient merges and calls
   * saveGroveMemory which runs toRpcPayload to split back into the array.
   */
  onSave: (fieldKey: string, value: string) => Promise<void>;
  /**
   * Test-mode override: 'view' | 'edit' bypasses internal useState so
   * renderToStaticMarkup tests can drive state directly without DOM clicks.
   * At runtime, leave this undefined.
   */
  testMode?: 'view' | 'edit';
}

// ---------------------------------------------------------------------------
// HardRulesBlock — main export
// ---------------------------------------------------------------------------

export function HardRulesBlock({
  rules,
  onSave,
  testMode,
}: HardRulesBlockProps): React.ReactElement {
  // Internal mode state — bypassed when testMode is set (for static tests).
  const [internalMode, setInternalMode] = useState<'view' | 'edit'>('view');

  // The raw string representation of the current rules (for FieldEditor).
  const rawValue = rulesArrayToString(rules);
  const [localRaw, setLocalRaw] = useState(rawValue);

  // Ref to the Edit button so focus can return after editing closes.
  const editBtnRef = useRef<HTMLButtonElement>(null);

  // Resolve effective mode: test override wins when set.
  const mode = testMode ?? internalMode;

  // Editor reducer state — owned here so we can observe mode transitions
  // (same pattern as FieldBlock, Task 8).
  const [editorState, editorDispatch] = useReducer(
    editReducer,
    localRaw,
    initialState,
  );

  // When editorState transitions to 'viewing' (cancel or saveSuccess),
  // switch back to view mode and return focus.
  useEffect(() => {
    if (testMode) return;
    if (internalMode === 'edit' && editorState.mode === 'viewing') {
      setInternalMode('view');
      setTimeout(() => editBtnRef.current?.focus(), 0);
    }
  }, [editorState.mode, internalMode, testMode]);

  function handleEditClick() {
    editorDispatch({ type: 'enter' });
    setInternalMode('edit');
  }

  async function handleEditorSave(value: string): Promise<void> {
    await onSave('hard_rules', value);
    setLocalRaw(value);
  }

  // ---------------------------------------------------------------------------
  // Render — view mode
  // ---------------------------------------------------------------------------

  const isEmpty = rules.length === 0;

  if (mode === 'view') {
    return (
      <div className={styles.hardRules}>
        {/* Header: eyebrow + sub-label + Edit button */}
        <div className={styles.hardRulesHeader}>
          <div className={styles.hardRulesLabels}>
            <p className={styles.hardRulesEyebrow}>HARD RULES</p>
            <p className={styles.hardRulesSubLabel}>Your Nibbins never break these</p>
          </div>
          <button
            ref={editBtnRef}
            type="button"
            className={styles.editBtn}
            aria-label="Edit Hard rules"
            onClick={testMode ? undefined : handleEditClick}
          >
            Edit
          </button>
        </div>

        {/* Content: rule list or empty placeholder */}
        {isEmpty ? (
          <p className={styles.hardRulesEmpty}>No hard rules yet</p>
        ) : (
          <ul className={styles.ruleList}>
            {rules.map((rule, i) => (
              <li key={i} className={styles.ruleBullet}>
                {rule}
              </li>
            ))}
          </ul>
        )}
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // Render — edit mode
  // ---------------------------------------------------------------------------

  return (
    <div className={styles.hardRules}>
      {/* Header: eyebrow + sub-label (no Edit button in edit mode) */}
      <div className={styles.hardRulesHeader}>
        <div className={styles.hardRulesLabels}>
          <p className={styles.hardRulesEyebrow}>HARD RULES</p>
          <p className={styles.hardRulesSubLabel}>Your Nibbins never break these</p>
        </div>
      </div>

      {/* FieldEditor: single textarea, one rule per line */}
      <FieldEditor
        fieldKey="hard_rules"
        label="Hard rules"
        hint="Your Nibbins never break these. One rule per line."
        state={editorState}
        dispatch={editorDispatch}
        initialValue={localRaw}
        onSave={handleEditorSave}
      />
    </div>
  );
}
