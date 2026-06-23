/**
 * Task 4 — Dynamic field registry.
 * Task 5 — Slug helper for server-side custom field key generation.
 *
 * Pure, deterministic helpers — no React, no DOM, no side effects.
 * Guard-free / client-safe: no `server-only` import.
 *
 * Exports:
 *  - SectionDescriptor: the full shape of a rendered section entry
 *  - FieldMetaRow: a row from field_meta (subset of columns used here)
 *  - buildSectionRegistry: merges DEFAULT_SECTIONS with field_meta overrides
 *  - forwardMapLegacy: maps legacy `facts` → `about` when `about` is empty
 *  - labelToFieldKey: server-side slug: label → `c_<slug>` matching ^c_[a-z0-9_]{1,40}$
 */

import { DEFAULT_SECTIONS, type FieldKind } from '../../../lib/grove/memory-sections';
import type { ValuesRecord } from './fields';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** The shape of a field_meta row as returned from Supabase (subset used here). */
export interface FieldMetaRow {
  field_key: string;
  /** Override label (null = use default). */
  label: string | null;
  /** Absolute sort order; lower values render first. */
  sort_order: number;
  /** True when this row represents a user-created custom section. */
  is_custom: boolean;
  /** True when this section should be hidden from the UI. */
  is_hidden: boolean;
}

/**
 * The descriptor shape the registry returns for each visible section.
 * Extends SectionEntry with optional fields for custom rows.
 */
export interface SectionDescriptor {
  key: string;
  label: string;
  kind: FieldKind | 'list';
  placeholder?: string;
  hint?: string;
  /** True for user-created custom sections. */
  isCustom?: boolean;
  /** The resolved sort order (for internal ordering). */
  sortOrder: number;
}

// ---------------------------------------------------------------------------
// Internal constants
// ---------------------------------------------------------------------------

/** Keys that are NEVER emitted as sections (handled separately by the RPC). */
const EXCLUDED_KEYS = new Set(['hard_rules', 'notes']);

/** Default sort orders for the canonical section keys (index × 100 gives spacing). */
function buildDefaultSortOrders(): Map<string, number> {
  const m = new Map<string, number>();
  DEFAULT_SECTIONS.forEach((s, i) => m.set(s.key, (i + 1) * 100));
  return m;
}

const DEFAULT_SORT_ORDERS = buildDefaultSortOrders();

// ---------------------------------------------------------------------------
// buildSectionRegistry
// ---------------------------------------------------------------------------

/**
 * Merge `DEFAULT_SECTIONS` with field_meta override rows to produce the ordered,
 * visible section list for the current account.
 *
 * Rules:
 *  1. `hard_rules` and `notes` are never emitted (they live as separate RPC params).
 *  2. For each default section, a non-custom meta row can:
 *     - Rename it (`label` override).
 *     - Reorder it (`sort_order` override).
 *     - Hide it (`is_hidden: true`).
 *  3. Custom rows (`is_custom: true`) are appended after defaults, ordered by `sort_order`.
 *  4. Hidden rows (default or custom) are excluded.
 *  5. All remaining rows are sorted by `sortOrder` ascending.
 *
 * @param metaRows - Rows from `field_meta` for the account (may be empty).
 * @returns Ordered array of SectionDescriptor (visible sections only).
 */
export function buildSectionRegistry(metaRows: FieldMetaRow[]): SectionDescriptor[] {
  // Build lookup of meta rows by field_key for O(1) access
  const metaByKey = new Map<string, FieldMetaRow>();
  for (const row of metaRows) {
    metaByKey.set(row.field_key, row);
  }

  const result: SectionDescriptor[] = [];

  // 1. Process default sections (applying overrides)
  for (const section of DEFAULT_SECTIONS) {
    if (EXCLUDED_KEYS.has(section.key)) continue;

    const meta = metaByKey.get(section.key);

    // Skip if hidden
    if (meta?.is_hidden) continue;

    const defaultSortOrder = DEFAULT_SORT_ORDERS.get(section.key) ?? 1000;

    result.push({
      key: section.key,
      label: meta?.label ?? section.label,
      kind: section.kind,
      placeholder: section.placeholder,
      hint: section.hint,
      isCustom: false,
      sortOrder: meta?.sort_order ?? defaultSortOrder,
    });
  }

  // 2. Process custom rows (is_custom: true, not excluded, not hidden)
  for (const row of metaRows) {
    if (!row.is_custom) continue;
    if (EXCLUDED_KEYS.has(row.field_key)) continue;
    if (row.is_hidden) continue;

    // Don't duplicate a key already in defaults (shouldn't happen, but guard it)
    if (DEFAULT_SORT_ORDERS.has(row.field_key)) continue;

    result.push({
      key: row.field_key,
      label: row.label ?? row.field_key,
      kind: 'list', // custom sections default to list kind
      isCustom: true,
      sortOrder: row.sort_order,
    });
  }

  // 3. Sort by sortOrder ascending
  result.sort((a, b) => a.sortOrder - b.sortOrder);

  return result;
}

// ---------------------------------------------------------------------------
// labelToFieldKey — Task 5 slug helper
// ---------------------------------------------------------------------------

/**
 * Converts a human-readable section label into a valid custom field key.
 *
 * Algorithm:
 *  1. Lowercase the label.
 *  2. Replace every non-alphanumeric character with `_`.
 *  3. Collapse consecutive `_` into a single `_`.
 *  4. Trim leading/trailing `_`.
 *  5. Clamp the body to 40 characters.
 *  6. If the body is empty after sanitization, use the fallback `section`.
 *  7. Prefix with `c_`.
 *
 * Result always matches `^c_[a-z0-9_]{1,40}$`.
 *
 * @param label - The user-supplied section label.
 * @returns A valid custom field key with `c_` prefix.
 */
export function labelToFieldKey(label: string): string {
  const body = label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_') // non-alphanumeric → _
    .replace(/_+/g, '_')          // collapse consecutive underscores
    .replace(/^_+|_+$/g, '')      // trim leading/trailing underscores
    .slice(0, 40);                 // clamp body to 40 chars

  return `c_${body || 'section'}`;
}

// ---------------------------------------------------------------------------
// forwardMapLegacy
// ---------------------------------------------------------------------------

/**
 * Forward-maps the legacy `facts` key → `about` when `about` is absent or blank.
 * The original `facts` key is retained in the returned object for safe round-trips.
 *
 * This is a non-destructive migration: code that still writes `facts` (e.g.
 * `seedSectionsFromAnswers` in page.tsx) continues to work; the `about` field
 * is populated automatically on read.
 *
 * @param values - The current flat key→string mirror.
 * @returns A new ValuesRecord (never mutates the input).
 */
export function forwardMapLegacy(values: ValuesRecord): ValuesRecord {
  const facts = values['facts'];
  if (facts === undefined || facts === null) return values;

  const about = values['about'];
  const aboutIsEmpty = about === undefined || about === null || String(about).trim() === '';

  if (aboutIsEmpty) {
    return { ...values, about: facts };
  }

  return { ...values };
}
