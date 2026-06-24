/**
 * Task 10 — MemorySection.tsx
 *
 * A purely presentational section wrapper used to group related FieldBlocks
 * on the Grove Memory tab (spec §3, §12).
 *
 * The two sections are:
 *   "About your business" — facts / pricing / policies
 *   "Voice & rules"       — voice / faq / notes / HardRulesBlock
 *
 * Responsibilities:
 *  - Render a section heading (h2 — semantic landmark, accessible outline)
 *  - Render an optional hint line below the heading
 *  - Render children (FieldBlock / HardRulesBlock instances) in order
 *
 * Intentionally thin: all field logic lives in FieldBlock / HardRulesBlock.
 * MemorySection owns only structure and grouping.
 *
 * CSS classes (token-only, added to memory.module.css):
 *   `.memorySection`   — root container
 *   `.sectionHeader`   — heading + hint area
 *   `.sectionHeading`  — h2 text
 *   `.sectionHint`     — optional supplemental hint (p)
 *   `.sectionFields`   — children container (field list)
 */

import React from 'react';
import styles from './memory.module.css';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface MemorySectionProps {
  /** Section heading shown above the field list (e.g. "About your business"). */
  heading: string;
  /** Optional supplemental hint rendered below the heading. */
  hint?: string;
  /** The FieldBlock / HardRulesBlock children for this section. */
  children: React.ReactNode;
}

// ---------------------------------------------------------------------------
// MemorySection — main export
// ---------------------------------------------------------------------------

export function MemorySection({
  heading,
  hint,
  children,
}: MemorySectionProps): React.ReactElement {
  return (
    <section className={styles.memorySection}>
      <div className={styles.sectionHeader}>
        <h2 className={styles.sectionHeading}>{heading}</h2>
        {hint && <p className={styles.sectionHint}>{hint}</p>}
      </div>
      <div className={styles.sectionFields}>{children}</div>
    </section>
  );
}
