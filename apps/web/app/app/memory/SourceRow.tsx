'use client';
/**
 * Task 9 — SourceRow.tsx
 *
 * A single row in the Sources library list.
 * Shows: type icon (by mimeGroup) + title + byte size + captured date + extraction-state chip.
 *
 * State chip mapping:
 *   extracted   → "Read"
 *   extracting  → "Reading…"
 *   unsupported → "Retained — not yet read"
 *   failed      → "Couldn't read"
 *   pending     → "Queued"
 *
 * Props consume SourceListItem from sourcesQuery.ts (Task 8).
 * No server imports; pure renderer — all state logic is in sourcesLibrary.reducer.ts.
 *
 * CSS: reuses existing memory.module.css tokens; adds sourceRow-specific classes.
 */

import React from 'react';
import type { SourceListItem, MimeGroup } from './sourcesQuery';
import styles from './memory.module.css';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Map extractionState → display chip label. */
export function extractionStateLabel(state: string): string {
  switch (state) {
    case 'extracted':   return 'Read';
    case 'extracting':  return 'Reading…';   // …
    case 'unsupported': return 'Retained — not yet read'; // — (em dash)
    case 'failed':      return "Couldn’t read"; // '
    case 'pending':     return 'Queued';
    default:            return state;
  }
}

/** Map extractionState → CSS modifier class key for the chip. */
function stateChipClass(state: string): string {
  switch (state) {
    case 'extracted':   return styles.sourceStateRead;
    case 'extracting':  return styles.sourceStateReading;
    case 'unsupported': return styles.sourceStateUnsupported;
    case 'failed':      return styles.sourceStateFailed;
    case 'pending':
    default:            return styles.sourceStatePending;
  }
}

/** Format bytes as a human-readable size string. */
function formatBytes(bytes: number | null): string {
  if (bytes === null || bytes === 0) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Format an ISO timestamp as a short date string. */
function formatDate(iso: string): string {
  if (!iso) return '';
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

/** Map mimeGroup to a short text icon label. */
function mimeGroupIcon(group: MimeGroup): string {
  switch (group) {
    case 'images':  return '🖼'; // 🖼
    case 'sheets':  return '📊'; // 📊
    case 'slides':  return '📋'; // 📋
    case 'web':     return '🌐'; // 🌐
    case 'docs':    return '📄'; // 📄
    case 'other':
    default:        return '📁'; // 📁
  }
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface SourceRowProps {
  item: SourceListItem;
}

// ---------------------------------------------------------------------------
// SourceRow — main export
// ---------------------------------------------------------------------------

export function SourceRow({ item }: SourceRowProps): React.ReactElement {
  const chipClass = stateChipClass(item.extractionState);
  const sizeStr = formatBytes(item.byteSize);
  const dateStr = formatDate(item.capturedAt);
  const icon = mimeGroupIcon(item.mimeGroup);
  const chip = extractionStateLabel(item.extractionState);

  return (
    <li className={styles.sourceRow} data-source-id={item.id}>
      {/* Type icon */}
      <span className={styles.sourceRowIcon} aria-hidden="true">
        {icon}
      </span>

      {/* Main content: title + meta */}
      <div className={styles.sourceRowContent}>
        <span className={styles.sourceRowTitle}>{item.title}</span>
        <span className={styles.sourceRowMeta}>
          {sizeStr && <span className={styles.sourceRowSize}>{sizeStr}</span>}
          {sizeStr && dateStr && (
            <span className={styles.sourceRowMetaSep} aria-hidden="true"> · </span>
          )}
          {dateStr && (
            <time className={styles.sourceRowDate} dateTime={item.capturedAt}>
              {dateStr}
            </time>
          )}
        </span>
      </div>

      {/* Extraction-state chip */}
      <span className={`${styles.sourceStateChip} ${chipClass}`} data-extraction-state={item.extractionState}>
        {chip}
      </span>
    </li>
  );
}
