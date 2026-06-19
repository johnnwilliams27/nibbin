'use client';

/**
 * The Grovekeeper in the scene — rendered exclusively by the creature engine
 * (canonical Keeper, ~140px, §4.2). Expression states are CSS transforms on
 * the wrapper around the engine's pose; the engine SVG itself is never
 * altered. The thinking journal doubles as the typing indicator.
 */
import { useEffect, useMemo, useState } from 'react';
import { buildCreature } from '@nibbin/creatures';
import type { KeeperExpression } from '@nibbin/keeper';
import styles from './grove.module.css';

function ThinkingJournal() {
  return (
    <span className={styles.journal} aria-hidden="true">
      <svg viewBox="0 0 40 30" width="40" height="30">
        <rect x="4" y="10" width="22" height="16" rx="2" fill="var(--shell)" stroke="var(--ink-soft)" strokeWidth="1" />
        <line x1="15" y1="10" x2="15" y2="26" stroke="var(--ink-soft)" strokeWidth="0.8" opacity="0.5" />
        <g className={styles.quill}>
          <path d="M30 4 L24 18" stroke="var(--moss-deep)" strokeWidth="1.6" strokeLinecap="round" />
          <path d="M30 4 q3 -2 5 -1 q-3 1 -3 4 Z" fill="var(--honey)" />
        </g>
        <circle className={styles.jot1} cx="8" cy="16" r="1.1" fill="var(--ink-soft)" />
        <circle className={styles.jot2} cx="11" cy="18" r="1.1" fill="var(--ink-soft)" />
        <circle className={styles.jot3} cx="9" cy="21" r="1.1" fill="var(--ink-soft)" />
      </svg>
    </span>
  );
}

/** One-shot leaf burst for delighted moments (first-time events only). */
function LeafBurst() {
  const leaves = [
    { dx: '-46px', dy: '-38px', rot: '-80deg' },
    { dx: '-26px', dy: '-58px', rot: '-30deg' },
    { dx: '4px', dy: '-64px', rot: '15deg' },
    { dx: '30px', dy: '-54px', rot: '50deg' },
    { dx: '48px', dy: '-32px', rot: '95deg' },
    { dx: '-52px', dy: '-12px', rot: '-120deg' },
  ];
  return (
    <span className={styles.burst} aria-hidden="true">
      {leaves.map((l, i) => (
        <svg
          key={i}
          className={styles.burstLeaf}
          style={{ '--dx': l.dx, '--dy': l.dy, '--rot': l.rot, '--delay': `${i * 40}ms` } as React.CSSProperties}
          viewBox="0 0 12 12"
          width="12"
          height="12"
        >
          <path d="M6 1 C10 3 10 8 6 11 C2 8 2 3 6 1 Z" fill="var(--leaf)" stroke="var(--moss)" strokeWidth="0.6" />
        </svg>
      ))}
    </span>
  );
}

export function KeeperSprite({
  expression,
  hatched,
  cracking,
  burstKey,
  name,
}: {
  expression: KeeperExpression;
  hatched: boolean;
  cracking: boolean;
  burstKey: number;
  name: string | null;
}) {
  const keeperSvg = useMemo(() => buildCreature({ species: 'Keeper', size: 96 }), []);
  const eggSvg = useMemo(() => buildCreature({ species: 'Sprout', stage: 'egg', size: 80 }), []);

  // The engine mints unique gradient/animation ids per render (GOTCHAS), so
  // SSR markup and the hydration render can never match byte-for-byte —
  // mount-gate the sprite instead of fighting it.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) {
    return <div className={styles.keeperSpot} style={{ minHeight: 96 }} aria-hidden="true" />;
  }

  return (
    <div className={styles.keeperSpot}>
      {!hatched ? (
        <div
          className={cracking ? `${styles.egg} ${styles.eggCracking}` : styles.egg}
          role="img"
          aria-label="An egg, about to hatch"
          dangerouslySetInnerHTML={{ __html: eggSvg }}
        />
      ) : (
        <div className={styles.keeper} data-expression={expression}>
          <div className={styles.keeperBody} dangerouslySetInnerHTML={{ __html: keeperSvg }} />
          {expression === 'thinking' && <ThinkingJournal />}
          {burstKey > 0 && <LeafBurst key={burstKey} />}
        </div>
      )}
      {hatched && <p className={styles.namePlate}>{name ?? 'Your Grovekeeper'}</p>}
    </div>
  );
}
