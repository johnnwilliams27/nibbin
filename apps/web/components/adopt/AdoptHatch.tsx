'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  buildCreature,
  type Accessory,
  type Marking,
  type SpeciesName,
  type Stage,
} from '@nibbin/creatures';
import { Button } from '../ui';
import styles from './adopt-hatch.module.css';

/** §9 fallback: a creature-engine failure yields copy-only, never a broken SVG. */
function safeBuild(opts: Parameters<typeof buildCreature>[0]): string {
  try {
    return buildCreature(opts);
  } catch {
    return '';
  }
}

const BURST = [
  { dx: '-46px', dy: '-38px', rot: '-80deg' },
  { dx: '-26px', dy: '-58px', rot: '-30deg' },
  { dx: '4px', dy: '-64px', rot: '15deg' },
  { dx: '30px', dy: '-54px', rot: '50deg' },
  { dx: '48px', dy: '-32px', rot: '95deg' },
  { dx: '-52px', dy: '-12px', rot: '-120deg' },
];

export interface AdoptHatchProps {
  name: string;
  species: string;
  stage: 'egg' | 'student';
  palette: string;
  accessory: string;
  marking: string;
  isFirstAdoption: boolean;
  onDismiss: () => void;
}

export function AdoptHatch({
  name,
  species,
  stage,
  palette,
  accessory,
  marking,
  isFirstAdoption,
  onDismiss,
}: AdoptHatchProps) {
  const [reducedMotion, setReducedMotion] = useState(false);
  const [hatched, setHatched] = useState(false);
  const [cracking, setCracking] = useState(false);
  const timers = useRef<number[]>([]);

  // A generic egg (matches the grove hatch); the real creature emerges from it.
  // §9: a creature-engine failure must fall back to a copy-only celebration —
  // never a broken animation as the "moment" — so the SVG build is guarded.
  const size = isFirstAdoption ? 132 : 104;
  const eggSvg = useMemo(() => safeBuild({ species: 'Sprout', stage: 'egg', size: 112 }), []);
  const creatureSvg = useMemo(
    () =>
      safeBuild({
        species: species as SpeciesName,
        stage: stage as Stage,
        color: palette,
        acc: accessory as Accessory,
        mark: marking as Marking,
        size,
      }),
    [species, stage, palette, accessory, marking, size],
  );

  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    setReducedMotion(mq.matches);
  }, []);

  // Esc dismisses the ceremony (the data behind it is never gated — §8/CE-P4).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onDismiss();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onDismiss]);

  // Egg cracks, then the adopted creature emerges (instant under reduced motion).
  useEffect(() => {
    if (reducedMotion) {
      setHatched(true);
      return;
    }
    const t1 = window.setTimeout(() => setCracking(true), 900);
    const t2 = window.setTimeout(() => setHatched(true), 1500);
    timers.current.push(t1, t2);
    return () => {
      window.clearTimeout(t1);
      window.clearTimeout(t2);
    };
  }, [reducedMotion]);

  useEffect(() => () => timers.current.forEach((t) => window.clearTimeout(t)), []);

  const title = isFirstAdoption ? `Meet ${name} — your first Nibbin` : `${name} hatched`;
  const body = isFirstAdoption
    ? `${name} is in your grove now, drafting for your approval. You set what it may do — Observe, Draft, or Send — and its grade climbs as you approve its work.`
    : `${name} is in your grove now, drafting for your approval. You set what it may do — Observe, Draft, or Send — and its grade climbs as you approve its work.`;

  return (
    <div className={styles.backdrop} role="dialog" aria-modal="true" aria-label={title}>
      <div className={styles.card}>
        {creatureSvg && (
        <div className={styles.spot}>
          {!hatched ? (
            <div
              className={cracking ? `${styles.egg} ${styles.eggCracking}` : styles.egg}
              role="img"
              aria-label="An egg, about to hatch"
              // eggSvg is built by the in-repo @nibbin/creatures engine from
              // fixed enum inputs — never user/runtime HTML (same trust basis as
              // every other creature render, e.g. grove/KeeperSprite.tsx).
              // nosemgrep: typescript.react.security.audit.react-dangerouslysetinnerhtml.react-dangerouslysetinnerhtml
              dangerouslySetInnerHTML={{ __html: eggSvg }}
            />
          ) : (
            <>
              <div
                className={`${styles.creature}${reducedMotion ? '' : ` ${styles.emerge}`}`}
                role="img"
                aria-label={`${name}, your new Nibbin`}
                // creatureSvg is built by the in-repo @nibbin/creatures engine
                // from fixed enum inputs — never user/runtime HTML (same trust
                // basis as every other creature render, e.g. nibbins/page.tsx).
                // nosemgrep: typescript.react.security.audit.react-dangerouslysetinnerhtml.react-dangerouslysetinnerhtml
                dangerouslySetInnerHTML={{ __html: creatureSvg }}
              />
              {!reducedMotion && (
                <span className={styles.burst} aria-hidden="true">
                  {BURST.map((l, i) => (
                    <svg
                      key={i}
                      className={styles.burstLeaf}
                      style={
                        { '--dx': l.dx, '--dy': l.dy, '--rot': l.rot, '--delay': `${i * 40}ms` } as React.CSSProperties
                      }
                      viewBox="0 0 12 12"
                      width="12"
                      height="12"
                    >
                      <path d="M6 1 C10 3 10 8 6 11 C2 8 2 3 6 1 Z" fill="var(--leaf)" stroke="var(--moss)" strokeWidth="0.6" />
                    </svg>
                  ))}
                </span>
              )}
            </>
          )}
        </div>
        )}
        <h2 className={styles.title}>{title}</h2>
        <p className={styles.body}>{body}</p>
        <Button type="button" variant="primary" className={styles.cta} onClick={onDismiss} autoFocus>
          Meet {name}
        </Button>
      </div>
    </div>
  );
}
