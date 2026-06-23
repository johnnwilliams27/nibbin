'use client';
/**
 * Task 11 — GroveMemoryTab.tsx (updated Task 6: dynamic registry + section controls)
 *
 * The "Grove Memory" truth tab content — the fully assembled per-field view
 * of the account's curated grove memory.
 *
 * Structure (spec §12 → Task 6 update):
 *   FramingStrip (suppressed when isEmpty)
 *   MemorySection "About your business"   ← dynamic registry fields (Task 6)
 *     [registry fields rendered dynamically]
 *     AddSectionControl (edit mode only)
 *   MemorySection "Voice & rules"
 *     HardRulesBlock (coral authority treatment — unchanged)
 *     FieldBlock: notes
 *   — OR —
 *   EmptyState (when isEmpty=true)
 *
 * Task 6 changes:
 *  - Accepts `registry: SectionDescriptor[]` to render fields dynamically
 *  - Accepts `sectionControlsState` + `sectionControlsDispatch` + `onSectionIntent`
 *    for section add/move/remove controls
 *  - `isEditing` controls visibility of section affordances
 *  - Falls back to FIELD_CONFIG for label/placeholder when registry is absent
 *
 * FieldBlock calls onSave(fieldKey, value) which is wired to MemoryClient's
 * mirror merge → saveGroveMemory server action. HardRulesBlock follows the
 * same onSave interface ('hard_rules', rawString).
 */

import React from 'react';
import { FramingStrip } from './FramingStrip';
import { MemorySection } from './MemorySection';
import { FieldBlock } from './FieldBlock';
import { HardRulesBlock } from './HardRulesBlock';
import { EmptyState } from './EmptyState';
import { AddSectionControl } from './AddSectionControl';
import { SectionActions } from './SectionActions';
import { FIELD_CONFIG } from './fields';
import type { FieldMeta } from './provenance';
import type { SectionDescriptor } from './registry';
import type { SectionControlsState, SectionControlsAction, SectionControlsIntent } from './sectionControls.reducer';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface GroveMemoryTabProps {
  /** The full field-value mirror from MemoryClient. */
  values: Record<string, string>;
  /** Whether all fields are empty (first-run state). */
  isEmpty: boolean;
  /**
   * Per-field save handler (wired to MemoryClient's mirror merge + server action).
   * Receives (fieldKey, rawValue).
   */
  onSave: (fieldKey: string, value: string) => Promise<void>;
  /**
   * Called when an EmptyState chip is clicked.
   * MemoryClient wires this to scroll + open the target FieldBlock in edit mode.
   */
  onChipClick: (fieldKey: string) => void;
  /**
   * F1 provenance metadata: per-field map from field key → FieldMeta.
   * When undefined (pre-F1), all FieldBlock provenance slots stay silent/empty.
   */
  fieldMeta?: Record<string, FieldMeta>;

  // ── Task 6: dynamic registry + section controls ──────────────────────────

  /**
   * Ordered, visible section list from buildSectionRegistry(metaRows).
   * Always provided by MemoryClient (never undefined); fresh accounts receive
   * the 7 neutral default sections. The legacy static fallback has been retired.
   */
  registry: SectionDescriptor[];
  /** Whether the UI is in "editing/management" mode (shows section controls). */
  isEditing?: boolean;
  /** State from sectionControlsReducer (for AddSectionControl + SectionActions). */
  sectionControlsState?: SectionControlsState;
  /** Dispatch from sectionControlsReducer. */
  sectionControlsDispatch?: (action: SectionControlsAction) => void;
  /** Called when a pending section intent needs to be submitted to the server. */
  onSectionIntent?: (intent: SectionControlsIntent) => Promise<void>;
}

// ---------------------------------------------------------------------------
// GroveMemoryTab — main export
// ---------------------------------------------------------------------------

export function GroveMemoryTab({
  values,
  isEmpty,
  onSave,
  onChipClick,
  fieldMeta,
  registry,
  isEditing = false,
  sectionControlsState,
  sectionControlsDispatch,
  onSectionIntent,
}: GroveMemoryTabProps): React.ReactElement {
  // Hard rules come from the mirror as a newline-separated string;
  // HardRulesBlock expects a string[] for display.
  const hardRulesRaw = values['hard_rules'] ?? '';
  const hardRulesArray = hardRulesRaw
    ? hardRulesRaw.split('\n').map((r) => r.trim()).filter(Boolean)
    : [];

  if (isEmpty) {
    return <EmptyState onChipClick={onChipClick} />;
  }

  return (
    <>
      {/* Framing strip: "Your Nibbins read this as truth…" */}
      <FramingStrip hidden={false} />

      {/* ── Section 1: About your business — dynamic registry (always) ──── */}
      {/* Task 7 fix: legacy hardcoded-field fallback retired. The registry is
          always built from buildSectionRegistry(metaRows ?? []), so fresh
          accounts see the 7 neutral default sections — never photographer copy. */}
      <MemorySection
        heading="About your business"
        hint="The basics your Nibbins use to keep every draft on-brand and accurate."
      >
        {registry.map((descriptor) => (
          <div key={descriptor.key}>
            <FieldBlock
              fieldKey={descriptor.key}
              label={descriptor.label}
              rawValue={values[descriptor.key] ?? ''}
              onSave={onSave}
              fieldMeta={fieldMeta?.[descriptor.key]}
            />
            {isEditing && sectionControlsState && sectionControlsDispatch && onSectionIntent && (
              <SectionActions
                section={descriptor}
                allSections={sectionControlsState.sections}
                dispatch={sectionControlsDispatch}
                onIntent={onSectionIntent}
                isEditing={isEditing}
              />
            )}
          </div>
        ))}
        {/* "+ Add a section" affordance — edit mode only */}
        {sectionControlsState && sectionControlsDispatch && onSectionIntent && (
          <AddSectionControl
            state={sectionControlsState}
            dispatch={sectionControlsDispatch}
            onIntent={onSectionIntent}
            isEditing={isEditing}
          />
        )}
      </MemorySection>

      {/* ── Section 2: Voice & rules — hard_rules / notes (always fixed) ── */}
      <MemorySection
        heading="Voice & rules"
        hint="How you sound and what's never up for debate — Nibbins treat these as gospel."
      >
        {/* HardRulesBlock — coral authority treatment (always rendered) */}
        <HardRulesBlock rules={hardRulesArray} onSave={onSave} />

        {/* notes — final field (always rendered) */}
        {(() => {
          const config = FIELD_CONFIG['notes'];
          if (!config) return null;
          return (
            <FieldBlock
              fieldKey="notes"
              label={config.label}
              rawValue={values['notes'] ?? ''}
              onSave={onSave}
              fieldMeta={fieldMeta?.['notes']}
            />
          );
        })()}
      </MemorySection>
    </>
  );
}
