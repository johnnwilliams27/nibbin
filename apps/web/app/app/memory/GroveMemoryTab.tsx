'use client';
/**
 * Task 11 — GroveMemoryTab.tsx
 *
 * The "Grove Memory" truth tab content — the fully assembled per-field view
 * of the account's curated grove memory.
 *
 * Structure (spec §12):
 *   FramingStrip (suppressed when isEmpty or editing)
 *   MemorySection "About your business"
 *     FieldBlock: facts
 *     FieldBlock: pricing
 *     FieldBlock: policies
 *   MemorySection "Voice & rules"
 *     FieldBlock: voice
 *     FieldBlock: faq
 *     HardRulesBlock (coral authority treatment)
 *     FieldBlock: notes
 *   — OR —
 *   EmptyState (when isEmpty=true)
 *
 * FieldBlock calls onSave(fieldKey, value) which is wired to MemoryClient's
 * mirror merge → saveGroveMemory server action. HardRulesBlock follows the
 * same onSave interface ('hard_rules', rawString).
 *
 * The FramingStrip is hidden on isEmpty (EmptyState carries its own framing)
 * and when any field is in active edit (keeps editing surface clean, §10).
 * Since GroveMemoryTab doesn't own edit mode state (FieldBlock does internally),
 * we rely on the parent passing `anyEditing` when it knows a field is open.
 * For this task (Task 11) we pass `hidden={isEmpty}` — the edit-mode suppression
 * is a polish task (Task 14).
 */

import React from 'react';
import { FramingStrip } from './FramingStrip';
import { MemorySection } from './MemorySection';
import { FieldBlock } from './FieldBlock';
import { HardRulesBlock } from './HardRulesBlock';
import { EmptyState } from './EmptyState';
import { FIELD_CONFIG } from './fields';

// ---------------------------------------------------------------------------
// Section configuration (spec §12 order)
// ---------------------------------------------------------------------------

const SECTIONS: Array<{
  heading: string;
  hint: string;
  fields: string[];
}> = [
  {
    heading: 'About your business',
    hint: 'The basics your Nibbins use to keep every draft on-brand and accurate.',
    fields: ['facts', 'pricing', 'policies'],
  },
  {
    heading: 'Voice & rules',
    hint: "How you sound and what's never up for debate — Nibbins treat these as gospel.",
    // 'hard_rules' is rendered via HardRulesBlock (inserted after 'faq')
    // 'notes' comes after HardRulesBlock
    fields: ['voice', 'faq'],
  },
];

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
}

// ---------------------------------------------------------------------------
// GroveMemoryTab — main export
// ---------------------------------------------------------------------------

export function GroveMemoryTab({
  values,
  isEmpty,
  onSave,
  onChipClick,
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

      {/* Section 1: About your business — facts / pricing / policies */}
      <MemorySection
        heading={SECTIONS[0].heading}
        hint={SECTIONS[0].hint}
      >
        {SECTIONS[0].fields.map((fieldKey) => {
          const config = FIELD_CONFIG[fieldKey];
          if (!config) return null;
          return (
            <FieldBlock
              key={fieldKey}
              fieldKey={fieldKey}
              label={config.label}
              rawValue={values[fieldKey] ?? ''}
              onSave={onSave}
            />
          );
        })}
      </MemorySection>

      {/* Section 2: Voice & rules — voice / faq / hard_rules / notes */}
      <MemorySection
        heading={SECTIONS[1].heading}
        hint={SECTIONS[1].hint}
      >
        {/* voice and faq via FieldBlock */}
        {SECTIONS[1].fields.map((fieldKey) => {
          const config = FIELD_CONFIG[fieldKey];
          if (!config) return null;
          return (
            <FieldBlock
              key={fieldKey}
              fieldKey={fieldKey}
              label={config.label}
              rawValue={values[fieldKey] ?? ''}
              onSave={onSave}
            />
          );
        })}

        {/* HardRulesBlock — coral authority treatment */}
        <HardRulesBlock rules={hardRulesArray} onSave={onSave} />

        {/* notes — final field in the section */}
        {(() => {
          const config = FIELD_CONFIG['notes'];
          if (!config) return null;
          return (
            <FieldBlock
              fieldKey="notes"
              label={config.label}
              rawValue={values['notes'] ?? ''}
              onSave={onSave}
            />
          );
        })()}
      </MemorySection>
    </>
  );
}
