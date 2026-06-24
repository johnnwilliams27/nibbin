/**
 * conflict-detect.ts — deterministic field-conflict detection for the C1 collate pass.
 *
 * Exports:
 *   detectFieldConflicts(fields, authority): FieldConflict[]
 *
 * Detection algorithm (v1 — no model calls):
 *   1. Normalize each contribution value: trim → lowercase → collapse internal whitespace.
 *   2. Ignore contributions whose normalized value is empty after normalization.
 *   3. A field has a conflict iff ≥2 distinct sources have normalized values that are
 *      materially different — i.e. neither normalized value is a substring of the other.
 *   4. currentValue is treated as a pseudo-contribution ONLY when ≥2 distinct SOURCES
 *      already disagree (the conflict is source-driven; currentValue alone cannot trigger one).
 *   5. competingSourceIds = all source ids whose normalized values participate in any
 *      pairwise material disagreement.
 *   6. suggestedSourceId = the competing source whose sourceKind has the highest authority
 *      weight; tie-break = first in input order.
 *   7. detail = short human one-liner naming the fieldKey and the distinct competing values
 *      (each truncated to ~60 chars, joined by " vs "; capped at ~300 chars total).
 *   8. stakes = scoreStakes(signals) — a weighted score over field criticality,
 *      competing-source count, authority spread, and divergence magnitude
 *      (see stakes-score.ts), thresholded to 'normal' | 'high'. (Was: a flat
 *      lookup against a 3-field set; that set is now one input to the score.)
 *
 * Design constraints:
 *   - Pure TypeScript — no I/O, no model calls, no DB access.
 *   - Deterministic: same inputs → same output on every call.
 *   - Fail-safe: individual field errors do NOT propagate (caller handles per-field).
 */

import { scoreStakes } from './stakes-score';

// ── Types ─────────────────────────────────────────────────────────────────────

/** The kind of source that produced a contribution. */
export type SourceKind = 'document' | 'connector_artifact' | 'observation' | 'manual';

/** A single source's contribution to a field's value. */
export interface Contribution {
  /** The unique id of the source (e.g. a sources.id from the DB). */
  sourceId: string;
  /** The kind of source. */
  sourceKind: SourceKind;
  /** The raw value this source provides for the field. */
  value: string;
}

/** Per-field input to conflict detection. */
export interface FieldInput {
  /** The field being checked (e.g. 'pricing', 'policies'). */
  fieldKey: string;
  /** The current curated value for this field (may be empty string). */
  currentValue: string;
  /** The contributing sources and the values they assert for this field. */
  contributions: Contribution[];
}

/** A detected conflict on a single field. */
export interface FieldConflict {
  /** The field that has a conflict. */
  fieldKey: string;
  /** The source ids of all contributions that participate in the disagreement. */
  competingSourceIds: string[];
  /**
   * The source id suggested as the canonical pick: the competing source whose
   * sourceKind has the highest authority weight (tie-break: first in input order).
   */
  suggestedSourceId: string;
  /** A short human one-liner describing the conflict and the competing values. */
  detail: string;
  /**
   * The DISTINCT competing values (original/trimmed text) the heuristic actually
   * deemed in conflict — first-appearance order, one per distinct normalized
   * value among the competing entries. This is the EXACT set the LLM judge must
   * see (conflict-judge.ts): it byte-for-byte matches what the heuristic
   * compared, so the judge cannot suppress on a value the heuristic never
   * flagged (logic-skeptic P1).
   */
  distinctValues: string[];
  /** 'high' for pricing/policies/hard_rules; 'normal' otherwise. */
  stakes: 'normal' | 'high';
}

// ── Constants ─────────────────────────────────────────────────────────────────

/** Maximum characters for each truncated value snippet in the detail string. */
const DETAIL_VALUE_TRUNCATE = 60;

/** Maximum total length of the detail string. */
const DETAIL_MAX_LENGTH = 300;

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Normalize a field value for conflict-detection comparison.
 * Steps: trim → lowercase → collapse internal whitespace to a single space.
 * Returns an empty string if the result is empty (caller should ignore such contributions).
 */
function normalize(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ');
}

/**
 * Returns true if neither string is a substring of the other.
 * When one value is a substring of the other we treat them as near-duplicates
 * and NOT a material conflict (avoids noise from elaborations/truncations).
 */
function isMateriallyDifferent(a: string, b: string): boolean {
  return !a.includes(b) && !b.includes(a);
}

/**
 * Truncate a string to at most `maxLen` characters, appending '…' if cut.
 */
function truncate(s: string, maxLen: number): string {
  if (s.length <= maxLen) return s;
  return s.slice(0, maxLen - 1) + '…';
}

// ── Core ──────────────────────────────────────────────────────────────────────

/**
 * Detect conflicts for a batch of fields given per-kind source authority weights.
 *
 * @param fields     Per-field inputs (fieldKey + currentValue + contributions).
 * @param authority  Per-SourceKind numeric weight (higher = more trusted).
 * @returns          Array of detected conflicts (empty when none).
 */
export function detectFieldConflicts(
  fields: FieldInput[],
  authority: Record<SourceKind, number>,
): FieldConflict[] {
  const results: FieldConflict[] = [];

  for (const field of fields) {
    const conflict = detectForField(field, authority);
    if (conflict !== null) {
      results.push(conflict);
    }
  }

  return results;
}

/**
 * Detect a conflict for a single field.  Returns null if no conflict.
 */
function detectForField(
  field: FieldInput,
  authority: Record<SourceKind, number>,
): FieldConflict | null {
  const { fieldKey, contributions } = field;

  // Step 1: Build effective contributions — normalized, non-empty only.
  // `original` is the trimmed source text, retained so the LLM judge can see
  // the real values (not the lowercased/whitespace-collapsed normalized form).
  const effective: Array<{ sourceId: string; sourceKind: SourceKind; normalized: string; original: string }> = [];
  for (const c of contributions) {
    const norm = normalize(c.value);
    if (norm.length > 0) {
      effective.push({ sourceId: c.sourceId, sourceKind: c.sourceKind, normalized: norm, original: c.value.trim() });
    }
  }

  // Need at least 2 effective contributions to have a conflict.
  if (effective.length < 2) return null;

  // Step 2: Determine which source ids participate in a material disagreement.
  // A source "participates" if there exists at least one OTHER source whose
  // normalized value is materially different from its own.
  const participating = new Set<string>();

  for (let i = 0; i < effective.length; i++) {
    for (let j = i + 1; j < effective.length; j++) {
      const a = effective[i];
      const b = effective[j];
      if (isMateriallyDifferent(a.normalized, b.normalized)) {
        participating.add(a.sourceId);
        participating.add(b.sourceId);
      }
    }
  }

  // No material disagreement found → no conflict.
  if (participating.size === 0) return null;

  // Step 3: Collect the competing source entries (preserve input order).
  const competingEntries = effective.filter((e) => participating.has(e.sourceId));
  const competingSourceIds = competingEntries.map((e) => e.sourceId);

  // Step 4: Determine suggestedSourceId — highest authority weight, tie-break = input order.
  let suggested = competingEntries[0];
  for (let i = 1; i < competingEntries.length; i++) {
    const candidate = competingEntries[i];
    if (authority[candidate.sourceKind] > authority[suggested.sourceKind]) {
      suggested = candidate;
    }
  }

  // Step 5: Build detail string.
  // Collect the distinct values by normalized identity, in first-appearance
  // order. We keep two parallel lists: the normalized form (for the human
  // detail snippet, unchanged) and the ORIGINAL trimmed text (for the LLM judge
  // and the returned distinctValues — the judge must see real values, and they
  // must be exactly the heuristic's competing set: logic-skeptic P1).
  const seenValues = new Set<string>();
  const distinctNormalized: string[] = [];
  const distinctValues: string[] = [];
  for (const e of competingEntries) {
    if (!seenValues.has(e.normalized)) {
      seenValues.add(e.normalized);
      distinctNormalized.push(e.normalized);
      distinctValues.push(e.original);
    }
  }
  const snippets = distinctNormalized.map((v) => `"${truncate(v, DETAIL_VALUE_TRUNCATE)}"`);
  const rawDetail = `Sources disagree on "${fieldKey}": ${snippets.join(' vs ')}`;
  const detail = rawDetail.length <= DETAIL_MAX_LENGTH
    ? rawDetail
    : rawDetail.slice(0, DETAIL_MAX_LENGTH - 1) + '…';

  // Step 6: Determine stakes via the real weighted score (stakes-score.ts).
  // Signals: field criticality, competing-source count, authority spread, and
  // divergence magnitude (distinct value count).
  const stakes: 'normal' | 'high' = scoreStakes({
    fieldKey,
    competingKinds: competingEntries.map((e) => e.sourceKind),
    distinctValueCount: distinctValues.length,
    authority,
  });

  return {
    fieldKey,
    competingSourceIds,
    suggestedSourceId: suggested.sourceId,
    detail,
    distinctValues,
    stakes,
  };
}
