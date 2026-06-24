'use client';
/**
 * Task 10 — EmptyState.tsx
 *
 * First-run state for the Grove Memory tab (spec §9).
 * Shown when all curated fields are empty (`isEmpty` from the server).
 *
 * Structure:
 *  1. Creature illustration — egg stage, 80×80px, via buildCreature
 *     (existing engine; the same pattern used in KeeperSprite.tsx)
 *  2. Two-line message (§9 copy):
 *       "Your grove doesn't know much yet"
 *       "Fill in a few sections and your Nibbins will start sounding
 *        unmistakably like you. Even one or two sentences per field
 *        makes a real difference."
 *  3. Two ghost affordance chips:
 *       [Start with business facts]  → onChipClick('facts')
 *       [Set your voice]             → onChipClick('voice')
 *
 * The chips carry `data-field-key` attributes so MemoryClient can wire them
 * to open that field in edit mode (Task 11 — the assembly task).
 *
 * Creature rendering note:
 *  `buildCreature` mints unique gradient/animation IDs per render via
 *  `nextUid()`, so SSR markup never matches the hydration render byte-for-byte.
 *  KeeperSprite handles this with a mounted gate (useState + useEffect). For
 *  EmptyState the creature is purely decorative — we render it on the server
 *  for static-markup tests (which is fine; the SVG is safe, §XSS note in
 *  build.ts) and let the client hydrate without complaint (the IDs change but
 *  the shape is equivalent). This matches what KeeperSprite does for its egg.
 *
 * Security: `buildCreature` output is XSS-safe (safeColor guard in build.ts
 * rejects any color that isn't a plain 6-digit hex). The species + stage are
 * string literals here — no user input flows into the engine.
 *
 * CSS classes (token-only, added to memory.module.css):
 *   `.emptyState`       — centered column layout
 *   `.emptyCreature`    — creature illustration wrapper
 *   `.emptyHeadline`    — h2 "Your grove doesn't know much yet"
 *   `.emptyBody`        — supplemental paragraph
 *   `.emptyChips`       — chip row
 *   `.chip`             — individual ghost affordance chip button
 */

import React from 'react';
import { buildCreature } from '@nibbin/creatures';
import styles from './memory.module.css';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface EmptyStateProps {
  /**
   * Called when the user clicks an affordance chip.
   * Receives the field key to open in edit mode ('facts' or 'voice').
   * Task 11 (MemoryClient) wires this to scroll + open the target field.
   */
  onChipClick: (fieldKey: string) => void;
}

// ---------------------------------------------------------------------------
// EmptyState — main export
// ---------------------------------------------------------------------------

export function EmptyState({ onChipClick }: EmptyStateProps): React.ReactElement {
  // Render the creature at egg stage (80×80px).
  // Using 'Sprout' species at 'egg' stage — matches KeeperSprite's egg pattern.
  const eggSvg = buildCreature({ species: 'Sprout', stage: 'egg', size: 80 });

  return (
    <div className={styles.emptyState}>
      {/* Creature illustration — egg stage */}
      <div
        className={styles.emptyCreature}
        role="img"
        aria-label="A nibbin egg, waiting to learn about your business"
        // Safe: buildCreature output is XSS-hardened (safeColor in build.ts)
        dangerouslySetInnerHTML={{ __html: eggSvg }}
      />

      {/* First-run message */}
      <h2 className={styles.emptyHeadline}>
        Your grove doesn&apos;t know much yet
      </h2>
      <p className={styles.emptyBody}>
        Fill in a few sections and your Nibbins will start sounding unmistakably
        like you. Even one or two sentences per field makes a real difference.
      </p>

      {/* Affordance chips */}
      <div className={styles.emptyChips}>
        <button
          type="button"
          className={styles.chip}
          data-field-key="facts"
          onClick={() => onChipClick('facts')}
        >
          Start with business facts
        </button>
        <button
          type="button"
          className={styles.chip}
          data-field-key="voice"
          onClick={() => onChipClick('voice')}
        >
          Set your voice
        </button>
      </div>
    </div>
  );
}
