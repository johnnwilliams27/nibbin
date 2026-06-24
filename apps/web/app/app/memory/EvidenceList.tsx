'use client';
/**
 * Task 13 — EvidenceList.tsx
 *
 * The gated evidence store panel on the Sources tab.
 *
 * Displays source cards grouped from the F1 `sources` table. Gated on two conditions:
 *   1. `sourcesEnabled` prop is true (driven by process.env.SOURCES_ENABLED)
 *   2. `rows` array is non-empty
 *
 * When either condition is false, renders the graceful empty banner (§8.2):
 *   "Everything Nibbin has read or watched to build your memory. The originals live
 *    here; your memory up top is the clean version."
 *
 * IMPORTANT: This component does NOT import any F1 table type at module scope.
 * Row data is typed as a plain interface (SourceRow) so this file is build-safe pre-F1.
 * The parent (SourcesTab / page.tsx) passes already-fetched rows as plain objects.
 *
 * CSS: adds `.evidenceEmpty`, `.evidenceEmptyBody`, `.evidenceList`, `.evidenceCard`,
 *      `.evidenceCardKind`, `.evidenceCardExcerpt`, `.evidenceCardMeta`
 *      to memory.module.css.
 */

import React from 'react';
import styles from './memory.module.css';

// ---------------------------------------------------------------------------
// Types — plain object, NO import from F1 schema modules
// ---------------------------------------------------------------------------

/**
 * A single evidence source row, passed in as a plain object by the parent.
 * Keeps this component build-safe pre-F1 — no F1 type imported at module scope.
 */
export interface SourceRow {
  id: string;
  /** The source kind (e.g. 'connector_artifact', 'observation', 'document'). */
  kind: string;
  /** Short excerpt from the source content. Null if not available. */
  excerpt: string | null;
  /** ISO 8601 timestamp of when this source was captured. Null if unknown. */
  captured_at: string | null;
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface EvidenceListProps {
  /**
   * Source rows loaded by the server page (F1 `sources` table).
   * Pass [] when the table is absent or empty — triggers graceful empty state.
   */
  rows: SourceRow[];
  /**
   * Whether the SOURCES_ENABLED feature flag is on.
   * When false: always renders graceful empty banner, regardless of rows.
   * Driven by `process.env.SOURCES_ENABLED === 'true'` in the parent.
   */
  sourcesEnabled: boolean;
}

// ---------------------------------------------------------------------------
// Empty state copy (§8.2 / §14.5)
// ---------------------------------------------------------------------------

const EMPTY_HEADLINE =
  'Everything Nibbin has read or watched to build your memory.';

const EMPTY_BODY =
  'The originals live here; your memory up top is the clean version. Evidence attaches automatically when the Foundation is live — nothing to set up.';

// ---------------------------------------------------------------------------
// EvidenceList — main export
// ---------------------------------------------------------------------------

export function EvidenceList({ rows, sourcesEnabled }: EvidenceListProps): React.ReactElement {
  // Show evidence cards only when the flag is on AND rows are present.
  const showCards = sourcesEnabled && rows.length > 0;

  if (!showCards) {
    return (
      <div className={styles.evidenceEmpty}>
        <p className={styles.evidenceEmptyHeadline}>{EMPTY_HEADLINE}</p>
        <p className={styles.evidenceEmptyBody}>{EMPTY_BODY}</p>
      </div>
    );
  }

  return (
    <ul className={styles.evidenceList}>
      {rows.map((row) => (
        <li key={row.id} className={styles.evidenceCard}>
          {/* Source type label */}
          <span className={styles.evidenceCardKind}>{row.kind}</span>

          {/* Excerpt — rendered when present */}
          {row.excerpt && (
            <p className={styles.evidenceCardExcerpt}>{row.excerpt}</p>
          )}

          {/* Last seen timestamp */}
          {row.captured_at && (
            <p className={styles.evidenceCardMeta}>
              Last seen{' '}
              <time dateTime={row.captured_at}>
                {formatCapturedAt(row.captured_at)}
              </time>
            </p>
          )}
        </li>
      ))}
    </ul>
  );
}

// ---------------------------------------------------------------------------
// Helper — format captured_at for display
// ---------------------------------------------------------------------------

/**
 * Format an ISO 8601 timestamp as a human-readable date (local).
 * Falls back to the raw string on parse error.
 */
function formatCapturedAt(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  } catch {
    return iso;
  }
}
