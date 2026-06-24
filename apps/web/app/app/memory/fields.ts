/**
 * Task 4 — Field config + value-mirror helpers.
 *
 * Pure, deterministic helpers — no React, no DOM, no side effects.
 *
 * Exports:
 *  - FIELD_CONFIG: per-key metadata (label, kind, placeholder, hint?)
 *  - CURATED_FIELD_KEYS: ordered list of all 9 curated field keys
 *    (7 neutral sections + hard_rules + notes)
 *  - mergeMirror: Option-A per-field mirror update (returns new object)
 *  - toRpcPayload: transforms the full mirror into the exact shape that
 *    save_grove_memory RPC expects: { sections, hard_rules[], notes }
 *
 * Task 4 update: rewritten for 7 neutral sections (about/offering/how/pricing/
 * policies/voice/faq). `toRpcPayload` now iterates the dynamic key set
 * (DEFAULT_SECTIONS keys ∪ custom c_* keys present in the mirror) instead of
 * the old fixed five. hard_rules and notes remain separate exactly as before.
 */

import { DEFAULT_SECTIONS } from '../../../lib/grove/memory-sections';
import type { FieldKind } from './format';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface FieldConfig {
  /** Human-readable label shown in the UI. */
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
// The 7 neutral default sections (from DEFAULT_SECTIONS) plus the two special
// fields hard_rules and notes (stored separately in the RPC, not as sections).
// ---------------------------------------------------------------------------

/** Build the base config entries from DEFAULT_SECTIONS. */
function buildDefaultFieldConfig(): Record<string, FieldConfig> {
  const out: Record<string, FieldConfig> = {};
  for (const s of DEFAULT_SECTIONS) {
    out[s.key] = {
      label: s.label,
      kind: s.kind,
      placeholder: s.placeholder,
      hint: s.hint,
    };
  }
  return out;
}

export const FIELD_CONFIG: Record<string, FieldConfig> = {
  ...buildDefaultFieldConfig(),
  hard_rules: {
    label: 'Hard rules',
    kind: 'list',
    placeholder: 'Never offer a discount without checking with me first\nNo out-of-scope work without a change order',
    hint: 'Your Nibbins never break these. One rule per line.',
  },
  notes: {
    label: 'Notes',
    kind: 'paragraphs',
    placeholder: 'Anything else your Nibbins should know — context that does not fit above.',
  },
} as const;

/**
 * The set of default section keys, in canonical order.
 * Does NOT include hard_rules or notes (those are separate RPC params).
 */
export const DEFAULT_SECTION_KEYS: ReadonlyArray<string> = DEFAULT_SECTIONS.map((s) => s.key);

/** Ordered array of all curated field keys, in display order. */
export const CURATED_FIELD_KEYS: ReadonlyArray<string> = [
  ...DEFAULT_SECTION_KEYS,
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

/** The keys that must NEVER appear in sections (handled separately). */
const SECTION_EXCLUDED = new Set(['hard_rules', 'notes']);

/**
 * Transforms the full per-field mirror into the exact args that
 * `save_grove_memory` expects.
 *
 * - `sections` — DEFAULT_SECTION_KEYS ∪ any custom `c_*` keys present in the
 *   mirror, trimmed, ≤6000 chars, omitted if blank. hard_rules/notes excluded.
 * - `hard_rules` — split on `\n`, each rule trimmed + filtered, capped at 50.
 * - `notes` — trimmed, ≤8000 chars; null when blank/absent.
 *
 * This is called by the `saveGroveMemory` server action so the same logic is
 * unit-testable without needing a server environment.
 */
export function toRpcPayload(values: ValuesRecord): RpcPayload {
  // Build the dynamic section key set:
  // 1. Start with the ordered defaults
  // 2. Append any custom c_* keys present in the mirror (in insertion order)
  const sectionKeys = new Set<string>(DEFAULT_SECTION_KEYS);
  for (const k of Object.keys(values)) {
    if (!SECTION_EXCLUDED.has(k) && !sectionKeys.has(k) && k.startsWith('c_')) {
      sectionKeys.add(k);
    }
  }

  // Build sections: only the computed key set, trimmed and non-blank
  const sections: Record<string, string> = {};
  for (const key of sectionKeys) {
    if (SECTION_EXCLUDED.has(key)) continue;
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
