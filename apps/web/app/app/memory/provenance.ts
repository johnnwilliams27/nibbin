/**
 * Task 12 — provenance.ts
 *
 * Pure helpers for provenance / staleness display on the Memory page.
 * No React, no DOM, no Supabase — all inputs are plain values.
 *
 * These functions were extracted from the inline helpers in FieldBlock.tsx
 * so they can be thoroughly unit-tested and shared across FieldBlock +
 * any future provenance consumers.
 *
 * Graceful-empty rules (§11 / §226):
 *  - Unknown / absent source string → null (silent, never "unknown")
 *  - null / undefined lastReviewedAt → no staleness (treat as "just reviewed")
 *  - null / undefined FieldMeta → no provenance text at all
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface FieldMeta {
  /** Where the field value came from. */
  source: string;
  /** ISO 8601 timestamp — when the field was last reviewed/confirmed. Null if never. */
  lastReviewedAt: string | null | undefined;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Number of days without review before a field is considered stale (§11). */
export const STALE_DAYS = 60;

// ---------------------------------------------------------------------------
// sourceLabel
// ---------------------------------------------------------------------------

/**
 * Returns a human-readable label for a known source origin,
 * or `null` for unknown/future sources.
 *
 * `null` → silent in the UI (never rendered as "unknown").
 */
export function sourceLabel(source: string): string | null {
  switch (source) {
    case 'field_study':     return 'From Field Study';
    case 'connector:gmail': return 'From Gmail';
    case 'user_entered':    return 'You wrote this';
    case 'seeded':          return 'From your onboarding';
    default:                return null;
  }
}

// ---------------------------------------------------------------------------
// staleness
// ---------------------------------------------------------------------------

/**
 * Computes whether a field is stale relative to `now`.
 *
 * - `null` / `undefined` lastReviewedAt → `{ stale: false, text: '' }` (silent)
 * - More than `STALE_DAYS` days since review → `{ stale: true, text: '— worth a check?' }`
 * - Otherwise → `{ stale: false, text: '' }`
 *
 * The stale threshold is strictly `>` (not `>=`), so exactly 60 days is not stale.
 */
export function staleness(
  lastReviewedAt: string | null | undefined,
  now: Date = new Date(),
): { stale: boolean; text: string } {
  if (!lastReviewedAt) {
    return { stale: false, text: '' };
  }
  const reviewed = new Date(lastReviewedAt);
  const diffMs = now.getTime() - reviewed.getTime();
  const diffDays = diffMs / (1000 * 60 * 60 * 24);
  if (diffDays > STALE_DAYS) {
    return { stale: true, text: '— worth a check?' };
  }
  return { stale: false, text: '' };
}

// ---------------------------------------------------------------------------
// provenanceText — composed label
// ---------------------------------------------------------------------------

/**
 * Returns the full composed provenance line for a field, or `null` when
 * there is nothing meaningful to display.
 *
 * Format:
 *  - Fresh: `"From Field Study"`
 *  - Stale:  `"From Field Study — worth a check?"`
 *  - No meta / unknown source: `null` (silent)
 *
 * @param fieldMeta  - F1 field_meta row (or null/undefined pre-F1)
 * @param now        - Optional: override current time (for tests)
 */
export function provenanceText(
  fieldMeta: FieldMeta | null | undefined,
  now: Date = new Date(),
): string | null {
  if (!fieldMeta) return null;

  const label = sourceLabel(fieldMeta.source);
  if (!label) return null; // unknown source → silent

  const { stale, text: staleText } = staleness(fieldMeta.lastReviewedAt, now);
  if (stale && staleText) {
    return `${label} ${staleText}`;
  }
  return label;
}
