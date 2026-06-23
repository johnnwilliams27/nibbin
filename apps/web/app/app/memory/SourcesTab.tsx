'use client';
/**
 * Task 13 — SourcesTab.tsx
 *
 * The Sources tab panel for the Memory page.
 *
 * Contains:
 *  1. `ReferenceCatchAll` — the freeform reference_text catch-all (always live)
 *  2. `EvidenceList`      — the gated F1 evidence store (graceful-empty pre-F1)
 *
 * Framing copy from §14.5:
 *  "Everything Nibbin has read or watched to build your memory. The originals live
 *   here; your memory up top is the clean version."
 *
 * The evidence gate is driven by:
 *  - `process.env.SOURCES_ENABLED === 'true'` (env flag; default false pre-F1)
 *  - Presence of passed-in `sourceRows` (non-empty = F1 has data for this account)
 *
 * CSS: adds `.sourcesTab`, `.sourcesSection`, `.sourcesSectionHeading`,
 *      `.sourcesDivider` to memory.module.css.
 */

import React from 'react';
import { ReferenceCatchAll } from './ReferenceCatchAll';
import { EvidenceList } from './EvidenceList';
import type { SourceRow } from './EvidenceList';
import styles from './memory.module.css';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface SourcesTabProps {
  /**
   * Current reference_text value (from the grove_memory row).
   * Empty string when the account has not saved any reference material yet.
   */
  referenceValue: string;
  /**
   * Save handler for the Reference catch-all field.
   * Called with the raw string; the caller handles FormData + RPC.
   */
  onSaveReference: (value: string) => Promise<void>;
  /**
   * Evidence source rows from F1's `sources` table.
   * Pass [] when the table is absent or empty — EvidenceList renders gracefully.
   */
  sourceRows?: SourceRow[];
}

// ---------------------------------------------------------------------------
// SourcesTab — main export
// ---------------------------------------------------------------------------

export function SourcesTab({
  referenceValue,
  onSaveReference,
  sourceRows = [],
}: SourcesTabProps): React.ReactElement {
  // The evidence gate: flag must be 'true' in env (default off pre-F1).
  const sourcesEnabled = process.env.SOURCES_ENABLED === 'true';

  return (
    <div className={styles.sourcesTab}>
      {/* ── Reference catch-all ───────────────────────────────────────────── */}
      <section className={styles.sourcesSection}>
        <h2 className={styles.sourcesSectionHeading}>Reference material</h2>
        <p className={styles.sourcesSectionHint}>
          Overflow context — anything you want your Nibbins to have in the background
          but that doesn&apos;t belong in the curated fields above.
        </p>
        <ReferenceCatchAll value={referenceValue} onSave={onSaveReference} />
      </section>

      {/* ── Divider ──────────────────────────────────────────────────────── */}
      <hr className={styles.sourcesDivider} />

      {/* ── Evidence store (F1-gated) ────────────────────────────────────── */}
      <section className={styles.sourcesSection}>
        <h2 className={styles.sourcesSectionHeading}>Evidence</h2>
        <p className={styles.sourcesSectionHint}>
          Everything Nibbin has read or watched to build your memory. The originals live
          here; your memory up top is the clean version.
        </p>
        <EvidenceList rows={sourceRows} sourcesEnabled={sourcesEnabled} />
      </section>
    </div>
  );
}
