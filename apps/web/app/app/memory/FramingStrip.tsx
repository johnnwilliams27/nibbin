/**
 * Task 10 — FramingStrip.tsx
 *
 * A single-line framing strip shown below the tab bar and above the first
 * section on the Grove Memory tab (spec §10).
 *
 * Copy: "Your Nibbins read this as truth. They'll quote it, paraphrase it,
 *        and follow it — every draft."
 *
 * Visual spec:
 *  - Background: `--understory`
 *  - Border radius: `--r-card`
 *  - Padding: `10px 14px`
 *  - Font: `--sans` 13px, `--ink-soft`
 *  - Leaf glyph (aria-hidden) on the left
 *
 * Suppression (controlled by the `hidden` prop):
 *  - First-run / empty state: hidden (the EmptyState carries its own framing)
 *  - Active edit mode: hidden (to keep the editing surface clean, §10)
 *  - Parent (GroveMemoryTab / MemoryClient) derives `hidden` from its own state.
 *
 * When `hidden` is true, the component renders null (no DOM node, no layout
 * reservation — this is a contextual hint, not a layout-critical slot).
 *
 * CSS classes: `.framingStrip`, `.framingGlyph`, `.framingCopy` — token-only.
 */

import React from 'react';
import styles from './memory.module.css';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface FramingStripProps {
  /**
   * When true, the strip is suppressed entirely (no DOM node).
   * Pass true on first-run (isEmpty) or when a field is in edit mode.
   * Defaults to false (visible).
   */
  hidden?: boolean;
}

// ---------------------------------------------------------------------------
// Leaf glyph — a small SVG leaf, aria-hidden, purely decorative
// ---------------------------------------------------------------------------

function LeafGlyph(): React.ReactElement {
  return (
    <svg
      aria-hidden="true"
      width="14"
      height="14"
      viewBox="0 0 14 14"
      fill="none"
      className={styles.framingGlyph}
    >
      {/* Simple leaf shape — uses token color via currentColor */}
      <path
        d="M7 1 C11 3 11 9 7 13 C3 9 3 3 7 1 Z"
        fill="currentColor"
        opacity="0.55"
      />
      <line
        x1="7"
        y1="13"
        x2="7"
        y2="7"
        stroke="currentColor"
        strokeWidth="0.8"
        opacity="0.4"
        strokeLinecap="round"
      />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// FramingStrip — main export
// ---------------------------------------------------------------------------

export function FramingStrip({ hidden = false }: FramingStripProps): React.ReactElement | null {
  if (hidden) return null;

  return (
    <div className={styles.framingStrip} role="note">
      <LeafGlyph />
      <span className={styles.framingCopy}>
        Your Nibbins read this as truth. They&apos;ll quote it, paraphrase it,
        and follow it — every draft.
      </span>
    </div>
  );
}
