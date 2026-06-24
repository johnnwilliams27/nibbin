'use client';
/**
 * Task 11 — MemoryClient.tsx (updated Task 6: dynamic registry + section controls)
 *
 * The top-level client shell for the Memory page.
 *
 * Owns:
 *  - Active tab state (`memory` | `sources`)
 *  - The per-field values mirror (Option A — full mirror, one key replaced per save)
 *  - Wires per-field saves through saveGroveMemory (full mirror → RPC)
 *  - Wires Reference saves through saveReference
 *  - Task 6: sectionControlsReducer state + intent dispatch (add/move/remove sections)
 *
 * Architecture (spec §5.4, §12):
 *  - MemoryClient renders TabBar + the active tab panel
 *  - Grove Memory tab: GroveMemoryTab (FramingStrip + MemorySections + EmptyState)
 *  - Sources tab: stub for Task 13 (ReferenceCatchAll + EvidenceList)
 *
 * Task 6 additions:
 *  - Accepts optional `metaRows` prop (field_meta rows from page.tsx)
 *  - Builds dynamic section registry via buildSectionRegistry(metaRows)
 *  - Owns sectionControlsReducer state
 *  - Handles section intents: upsert_hide/upsert_new/upsert_pair → saveSectionMeta;
 *    delete → deleteSection
 */

import React, { useState, useCallback, useReducer } from 'react';
import { TabBar, PANEL_IDS, TAB_IDS } from './TabBar';
import { GroveMemoryTab } from './GroveMemoryTab';
import { SourcesTab } from './SourcesTab';
import { mergeMirror } from './fields';
import { saveGroveMemory, saveReference, saveSectionMeta, deleteSection } from './actions';
import { buildSectionRegistry, type FieldMetaRow } from './registry';
import {
  sectionControlsReducer,
  initialSectionControlsState,
  type SectionControlsIntent,
} from './sectionControls.reducer';
import type { TabKey } from './tabBar.logic';
import type { FieldMeta } from './provenance';
import styles from './memory.module.css';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface MemoryClientProps {
  /**
   * Initial field values loaded by the server page.
   * Keys: facts, pricing, policies, faq, voice, hard_rules, notes.
   */
  initialValues: Record<string, string>;
  /**
   * Initial reference_text value (Sources tab catch-all).
   */
  initialReference: string;
  /**
   * Whether all curated fields are empty (first-run state).
   * Used to show EmptyState instead of MemorySections on the truth tab.
   */
  isEmpty: boolean;
  /**
   * F1 provenance metadata: per-field map from field key → FieldMeta.
   * Passed to GroveMemoryTab → FieldBlock for the provenance slot.
   * When undefined (pre-F1 or try/catch silent fail), all provenance slots stay empty.
   */
  fieldMeta?: Record<string, FieldMeta>;
  /**
   * Task 6: field_meta rows from the database (includes new columns:
   * label, sort_order, is_custom, is_hidden). The dynamic registry is ALWAYS
   * built from these rows (or the neutral defaults when empty/absent).
   * The legacy static rendering path has been retired (Task 7 fix).
   */
  metaRows?: FieldMetaRow[];
}

// ---------------------------------------------------------------------------
// MemoryClient — main export
// ---------------------------------------------------------------------------

export function MemoryClient({
  initialValues,
  initialReference,
  isEmpty,
  fieldMeta,
  metaRows,
}: MemoryClientProps): React.ReactElement {
  // ---------------------------------------------------------------------------
  // State
  // ---------------------------------------------------------------------------

  const [activeTab, setActiveTab] = useState<TabKey>('memory');
  const [values, setValues] = useState<Record<string, string>>(initialValues);
  // Task 13: promoted from useRef to useState so ReferenceCatchAll can consume it.
  const [referenceValue, setReferenceValue] = useState(initialReference);

  // Task 7 fix: ALWAYS build from the neutral defaults (or metaRow overrides).
  // buildSectionRegistry([]) returns the 7 neutral default sections, so fresh
  // accounts and accounts with no customisations get the correct neutral UI —
  // never the legacy photographer-flavoured fallback.
  const registry = buildSectionRegistry(metaRows ?? []);

  // Task 6: section controls state machine
  const [sectionControlsState, sectionControlsDispatch] = useReducer(
    sectionControlsReducer,
    registry,
    initialSectionControlsState,
  );

  // ---------------------------------------------------------------------------
  // Save handlers
  // ---------------------------------------------------------------------------

  /**
   * Per-field save for all curated fields (facts / pricing / policies / faq /
   * voice / hard_rules / notes).
   *
   * Merges the new value into the mirror (Option A) and sends the FULL mirror
   * through saveGroveMemory so the sections JSONB column is never partial.
   */
  const handleSave = useCallback(async (fieldKey: string, value: string) => {
    const next = mergeMirror(values, fieldKey, value);
    // Optimistically update local state first.
    setValues(next as Record<string, string>);

    // Build FormData from the full mirror (server action reads via FormData.get).
    const fd = new FormData();
    for (const [k, v] of Object.entries(next)) {
      if (typeof v === 'string') fd.set(k, v);
    }
    // saveGroveMemory redirects on success (non-JS fallback); in per-field mode
    // we catch the redirect sentinel silently — the optimistic update already reflects
    // the new state. On actual save errors the server action redirects to ?error=1;
    // in per-field mode this surfaces as a thrown redirect which we swallow here
    // (Task 14 / motion pass can add inline error toast).
    try {
      await saveGroveMemory(fd);
    } catch {
      // Next.js server actions throw a NEXT_REDIRECT sentinel on redirect();
      // swallow it here — the optimistic state update is already done.
    }
  }, [values]);

  /**
   * Reference field save (Sources tab catch-all — wired in Task 13).
   * Called by ReferenceCatchAll with the raw string value.
   * Optimistically updates local state, then writes through the server action.
   */
  const handleSaveReference = useCallback(async (value: string) => {
    // Optimistic update — show the new value immediately.
    setReferenceValue(value);
    const fd = new FormData();
    fd.set('reference', value);
    const result = await saveReference(fd);
    if (!result.ok) {
      // Roll back the optimistic update on failure.
      setReferenceValue(referenceValue);
      throw new Error(result.error);
    }
  }, [referenceValue]);

  /**
   * Task 6: Handle a pending section intent (from sectionControlsReducer).
   * Submits the intent to the appropriate server action, then clears it.
   *
   * Intent types:
   *   upsert_hide  → saveSectionMeta({ field_key, is_hidden: true })
   *   upsert_new   → saveSectionMeta({ label, is_custom: true, sort_order })
   *   upsert_pair  → saveSectionMeta twice (one per swapped section)
   *   delete       → deleteSection({ field_key })
   */
  const handleSectionIntent = useCallback(async (intent: SectionControlsIntent) => {
    try {
      if (intent.type === 'delete') {
        const fd = new FormData();
        fd.set('field_key', intent.key);
        await deleteSection(fd);
      } else if (intent.type === 'upsert_hide') {
        const fd = new FormData();
        fd.set('field_key', intent.key);
        fd.set('is_hidden', 'true');
        fd.set('is_custom', 'false');
        fd.set('sort_order', '1000');
        await saveSectionMeta(fd);
      } else if (intent.type === 'upsert_new') {
        const fd = new FormData();
        fd.set('label', intent.label);
        fd.set('is_custom', 'true');
        fd.set('is_hidden', 'false');
        fd.set('sort_order', String(intent.sortOrder));
        await saveSectionMeta(fd);
      } else if (intent.type === 'upsert_pair') {
        // Submit both swapped sections
        await Promise.all(
          intent.pairs.map((pair) => {
            const fd = new FormData();
            fd.set('field_key', pair.key);
            fd.set('sort_order', String(pair.sortOrder));
            fd.set('is_custom', pair.isCustom ? 'true' : 'false');
            fd.set('is_hidden', 'false');
            return saveSectionMeta(fd);
          }),
        );
      }
    } catch {
      // Non-fatal: intent submission errors are swallowed silently for now.
      // Task 10 (polish pass) can add inline error feedback.
    } finally {
      sectionControlsDispatch({ type: 'CLEAR_INTENT' });
    }
  }, [sectionControlsDispatch]);

  // ---------------------------------------------------------------------------
  // EmptyState chip click — open the named field in edit mode
  // ---------------------------------------------------------------------------

  // Task 11 wires this: open the FieldBlock for `fieldKey` in edit mode.
  // Since FieldBlocks own their own mode state internally (via useState in FieldBlock),
  // we use a ref-based callback pattern: MemoryClient tracks which field should
  // open via state, and passes it down. FieldBlock checks `openFieldKey` on mount.
  //
  // For Task 11 (assembly), we track the chip-requested field key in state so
  // it can be passed to GroveMemoryTab. The actual auto-open mechanism is a
  // future refinement (motion/a11y pass, Task 14) — for now clicking a chip
  // scrolls to the section but the field opens on user click. The testable seam
  // (the data-field-key attribute + the onChipClick callback) is in place.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [_openFieldKey, setOpenFieldKey] = useState<string | null>(null);

  const handleChipClick = useCallback((fieldKey: string) => {
    setOpenFieldKey(fieldKey);
    // Scroll the field into view: find the button with aria-label="Edit {label}"
    // and focus/click it. This is a best-effort DOM operation that does not affect
    // the renderToStaticMarkup test path.
    if (typeof document !== 'undefined') {
      // Attempt to find and click the edit button for this field.
      const config = import('./fields').then(({ FIELD_CONFIG }) => {
        const label = FIELD_CONFIG[fieldKey]?.label ?? fieldKey;
        const btn = document.querySelector<HTMLButtonElement>(
          `button[aria-label="Edit ${label}"]`,
        );
        if (btn) {
          btn.scrollIntoView({ behavior: 'smooth', block: 'center' });
          btn.click();
        }
      });
      void config;
    }
  }, []);

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <div className={styles.memoryClient}>
      {/* Tab bar */}
      <TabBar activeTab={activeTab} onTabChange={setActiveTab} />

      {/* Grove Memory tab panel.
          Motion: .tabPanelActive applies a gentle fade-in when the panel becomes
          visible. The hidden attribute suppresses the panel when inactive, and the
          animation re-fires on reveal. Reduced-motion is handled globally. */}
      <div
        id={PANEL_IDS.memory}
        role="tabpanel"
        aria-labelledby={TAB_IDS.memory}
        hidden={activeTab !== 'memory'}
        className={`${styles.tabPanel} ${styles.tabPanelActive}`}
      >
        <GroveMemoryTab
          values={values}
          isEmpty={isEmpty}
          onSave={handleSave}
          onChipClick={handleChipClick}
          fieldMeta={fieldMeta}
          registry={registry}
          sectionControlsState={sectionControlsState}
          sectionControlsDispatch={sectionControlsDispatch}
          onSectionIntent={handleSectionIntent}
        />
      </div>

      {/* Sources tab panel — Task 13: ReferenceCatchAll + EvidenceList.
          Motion: same tabPanelActive fade applied on reveal. */}
      <div
        id={PANEL_IDS.sources}
        role="tabpanel"
        aria-labelledby={TAB_IDS.sources}
        hidden={activeTab !== 'sources'}
        className={`${styles.tabPanel} ${styles.tabPanelActive}`}
      >
        <SourcesTab
          referenceValue={referenceValue}
          onSaveReference={handleSaveReference}
        />
      </div>
    </div>
  );
}
