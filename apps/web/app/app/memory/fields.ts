/**
 * Task 4 — Field config + value-mirror helpers.
 *
 * Pure, deterministic helpers — no React, no DOM, no side effects.
 *
 * Exports:
 *  - FIELD_CONFIG: per-key metadata (label, kind, placeholder, hint?)
 *  - CURATED_FIELD_KEYS: ordered list of all 7 curated field keys
 *  - mergeMirror: Option-A per-field mirror update (returns new object)
 *  - toRpcPayload: transforms the full mirror into the exact shape that
 *    save_grove_memory RPC expects: { sections, hard_rules[], notes }
 *
 * Label values MUST stay in sync with MEMORY_SECTIONS in lib/grove/memory.ts.
 * This file imports MEMORY_SECTIONS to derive them — no manual label strings
 * that could drift apart from the drafter's memory block.
 */

import { MEMORY_SECTIONS } from '../../../lib/grove/memory-sections';
import type { FieldKind } from './format';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface FieldConfig {
  /** Human-readable label shown in the UI (matches MEMORY_SECTIONS where applicable). */
  label: string;
  /** Controls which formatter Task 3's formatField uses for this field. */
  kind: FieldKind | 'list';
  /** Placeholder shown in empty view and in the editor textarea. */
  placeholder: string;
  /** Optional supplemental hint shown above the editor. */
  hint?: string;
}

/** Flat key→string mirror: the single source of truth in MemoryClient state. */
export type ValuesRecord = Partial<Record<string, string>>;

/** The shape save_grove_memory RPC expects. */
export interface RpcPayload {
  sections: Record<string, string>;
  hard_rules: string[];
  notes: string | null;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_SECTION_CHARS = 6000;
const MAX_NOTES_CHARS = 8000;
const MAX_HARD_RULES = 50;

// ---------------------------------------------------------------------------
// FIELD_CONFIG
//
// Keys in the MEMORY_SECTIONS array (facts/pricing/policies/faq/voice) re-use
// the labels from that array to guarantee no drift. hard_rules and notes are
// stored separately in the RPC but behave as fields on the UI.
// ---------------------------------------------------------------------------

/** Build the label lookup from MEMORY_SECTIONS once at module init. */
const _sectionLabels: Record<string, string> = Object.fromEntries(
  MEMORY_SECTIONS.map(({ key, label }) => [key, label]),
);

export const FIELD_CONFIG: Record<string, FieldConfig> = {
  facts: {
    label: _sectionLabels['facts'] ?? 'Business facts',
    kind: 'dl',
    placeholder: 'Business type: Photography\nLocation: Portland, OR\nFounded: 2018',
    hint: 'Use "Label: value" lines — one fact per line.',
  },
  pricing: {
    label: _sectionLabels['pricing'] ?? 'Pricing',
    kind: 'list',
    placeholder: 'Standard session: $400\nMini session: $150\nFull-day coverage: $1,200',
    hint: 'List your packages, one per line. Blank lines create visual breaks.',
  },
  policies: {
    label: _sectionLabels['policies'] ?? 'Policies',
    kind: 'list',
    placeholder: '48-hour cancellation policy\n50% deposit required\nTravel within 50 miles included',
    hint: 'One policy per line.',
  },
  faq: {
    label: _sectionLabels['faq'] ?? 'Common questions',
    kind: 'list',
    placeholder: 'Do you travel? Yes, within Oregon.\nHow long until I get photos? 2–3 weeks.',
    hint: 'One question-answer pair per line.',
  },
  voice: {
    label: _sectionLabels['voice'] ?? 'Voice & tone',
    kind: 'quote',
    placeholder: "Warm, direct, and never jargon-heavy. Every client is a person, not a project.",
    hint: 'Write how you naturally speak. Your Nibbins will match this.',
  },
  hard_rules: {
    label: 'Hard rules',
    kind: 'list',
    placeholder: 'Never offer a discount without checking with me first\nNo alcohol-related shoots',
    hint: 'Your Nibbins never break these. One rule per line.',
  },
  notes: {
    label: 'Notes',
    kind: 'paragraphs',
    placeholder: 'Anything else your Nibbins should know — context that does not fit above.',
  },
} as const;

/** Ordered array of all 7 curated field keys, in display order. */
export const CURATED_FIELD_KEYS: ReadonlyArray<string> = [
  'facts',
  'pricing',
  'policies',
  'faq',
  'voice',
  'hard_rules',
  'notes',
] as const;

// ---------------------------------------------------------------------------
// mergeMirror — Option A: one-key replace, immutable
// ---------------------------------------------------------------------------

/**
 * Returns a new `ValuesRecord` with `key` replaced by `newValue`.
 * Does NOT mutate the input record. Safe to call in a React state setter.
 *
 * @param values   - The current full mirror.
 * @param key      - The field key being updated.
 * @param newValue - The new raw string value for that field.
 */
export function mergeMirror(values: ValuesRecord, key: string, newValue: string): ValuesRecord {
  return { ...values, [key]: newValue };
}

// ---------------------------------------------------------------------------
// toRpcPayload — pure core of the server action
// ---------------------------------------------------------------------------

/**
 * Transforms the full per-field mirror into the exact args that
 * `save_grove_memory` expects.
 *
 * - `sections` — only MEMORY_SECTIONS keys, trimmed, ≤6000 chars, omitted if blank.
 * - `hard_rules` — split on `\n`, each rule trimmed + filtered, capped at 50.
 * - `notes` — trimmed, ≤8000 chars; null when blank/absent.
 *
 * This is called by the `saveGroveMemory` server action so the same logic is
 * unit-testable without needing a server environment.
 */
export function toRpcPayload(values: ValuesRecord): RpcPayload {
  // Build sections: only the keys that live in MEMORY_SECTIONS
  const sections: Record<string, string> = {};
  for (const { key } of MEMORY_SECTIONS) {
    const raw = values[key];
    if (raw === undefined || raw === null) continue;
    const trimmed = String(raw).trim().slice(0, MAX_SECTION_CHARS);
    if (trimmed) sections[key] = trimmed;
  }

  // hard_rules: split, trim, filter blanks, cap at 50
  const rawRules = values['hard_rules'];
  const hard_rules: string[] =
    rawRules === undefined || rawRules === null
      ? []
      : String(rawRules)
          .split('\n')
          .map((r) => r.trim())
          .filter(Boolean)
          .slice(0, MAX_HARD_RULES);

  // notes: trim, cap, null when blank
  const rawNotes = values['notes'];
  const trimmedNotes =
    rawNotes === undefined || rawNotes === null ? '' : String(rawNotes).trim().slice(0, MAX_NOTES_CHARS);
  const notes = trimmedNotes || null;

  return { sections, hard_rules, notes };
}
