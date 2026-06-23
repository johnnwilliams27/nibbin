'use client';

/**
 * StudySuggestionsBanner — post-study banner on the Memory page (P3 Task 8).
 *
 * Rendered when ?from_study=1 is present AND there are pending capture proposals.
 * Self-contained client component; mount point for P1 redesign:
 *
 *   <StudySuggestionsBanner count={pendingCaptureCount} />
 *
 * just below the page lede (before the F2 review queue). Renders nothing when
 * count=0 or the user has dismissed it.
 *
 * §5.2 framing: "Your Nibbin found N thing(s) to add to your memory — ready when
 * you are." Never surfaces raw captured content.
 *
 * Dismiss is in-memory (clears on next page load) — intentional. A persisted
 * dismiss would need a migration; the banner only appears on ?from_study=1 anyway.
 */

import { useState } from 'react';
import styles from './capture-tag.module.css';

export interface StudySuggestionsBannerProps {
  /** Number of pending capture-origin proposals. Renders nothing when 0. */
  count: number;
}

export function StudySuggestionsBanner({ count }: StudySuggestionsBannerProps) {
  const [dismissed, setDismissed] = useState(false);

  if (count === 0 || dismissed) return null;

  const thingLabel = count === 1 ? '1 thing' : `${count} things`;

  return (
    <div className={styles.banner} role="status" aria-live="polite">
      <div className={styles.bannerBody}>
        {/* Leaf/sprout icon — inline SVG uses currentColor; token-driven size */}
        <svg
          className={styles.bannerIcon}
          viewBox="0 0 20 20"
          fill="none"
          aria-hidden="true"
          xmlns="http://www.w3.org/2000/svg"
        >
          <path
            d="M10 2C6 2 3 5.5 3 9c0 3 2 5.5 5 6.5V18h2v-2.5c3-1 5-3.5 5-6.5 0-3.5-3-7-5-7z"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinejoin="round"
          />
        </svg>
        <p className={styles.bannerText}>
          Your Nibbin found{' '}
          <strong>{thingLabel}</strong>{' '}
          to add to your memory — ready when you are.
        </p>
      </div>
      <button
        type="button"
        className={styles.bannerDismiss}
        onClick={() => setDismissed(true)}
        aria-label="Dismiss this suggestion banner"
      >
        Dismiss
      </button>
    </div>
  );
}
