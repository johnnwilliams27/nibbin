'use client';

import { useEffect, useState } from 'react';
import styles from './diagnosis.module.css';

/**
 * Plays the reveal ceremony on the FIRST view of a diagnosis only (§5/§9).
 * "First view" is remembered per-device in localStorage keyed by the diagnosis
 * id; a returning user (or reduced-motion) gets the static reveal — the data is
 * identical, only the staged entrance differs (CE-P4, never gate the data).
 */
export function RevealStage({
  diagnosisId,
  children,
}: {
  diagnosisId: string;
  children: React.ReactNode;
}) {
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    // SSR + the first client render must agree (no class), so the decision is
    // made in an effect; the class is added one tick later. That tick is
    // invisible (the entrance animations start from the hidden/at-rest state).
    const key = `nibbin:reveal-seen:${diagnosisId}`;
    let seen = false;
    try {
      seen = window.localStorage.getItem(key) === '1';
    } catch {
      // storage blocked (private mode) — treat as seen, skip the show.
      seen = true;
    }
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (!seen && !reduced) {
      setPlaying(true);
      try {
        window.localStorage.setItem(key, '1');
      } catch {
        /* ignore */
      }
    }
  }, [diagnosisId]);

  return <div className={playing ? styles.playing : undefined}>{children}</div>;
}
