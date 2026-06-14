'use client';

/**
 * The grove — the Grovekeeper's visual scene (§4.2). Full-bleed layered
 * backdrop with time-of-day palette and ≤8px parallax. The chat engine
 * (state, effects, log, composer, sprite) now lives in KeeperChat; this
 * component is a thin scene wrapper that renders it inside the scene chrome.
 *
 * Reduced motion: scene becomes a calm static backdrop — no parallax,
 * no parallax layer motion — while KeeperChat retains full feature parity.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  type KeeperExpression,
  type KeeperMessage,
  type OnboardingStep,
  type UnderstandingProfile,
} from '@nibbin/keeper';
import { KeeperChat } from './KeeperChat';
import styles from './grove.module.css';

type Theme = 'dawn' | 'day' | 'dusk';

function themeForHour(hour: number): Theme {
  if (hour >= 5 && hour < 9) return 'dawn';
  if (hour >= 9 && hour < 18) return 'day';
  return 'dusk';
}

/** Layered scene backdrop. Pure decoration — hidden from the tree. */
function SceneLayers() {
  return (
    <div className={styles.layers} aria-hidden="true">
      <div className={styles.glow} />
      <svg className={styles.layerFar} viewBox="0 0 1200 240" preserveAspectRatio="xMidYMax slice">
        <path d="M0 240 L0 150 Q120 90 260 130 Q400 60 540 110 Q700 40 850 100 Q1020 60 1200 120 L1200 240 Z" fill="var(--g-far)" />
      </svg>
      <svg className={styles.layerMid} viewBox="0 0 1200 260" preserveAspectRatio="xMidYMax slice">
        <path d="M0 260 L0 190 Q80 150 150 170 L165 120 Q170 95 185 120 L198 172 Q300 140 380 168 L398 96 Q405 70 420 96 L436 170 Q560 135 660 168 Q780 130 900 165 L918 110 Q925 85 940 110 L955 168 Q1080 140 1200 175 L1200 260 Z" fill="var(--g-mid)" />
      </svg>
      <svg className={styles.layerNear} viewBox="0 0 1200 140" preserveAspectRatio="xMidYMax slice">
        <path d="M0 140 L0 70 Q60 50 120 66 Q140 30 158 62 Q220 44 300 62 Q330 26 352 58 Q450 40 560 60 Q600 24 630 56 Q740 38 850 58 Q890 28 916 56 Q1040 40 1200 64 L1200 140 Z" fill="var(--g-near)" />
      </svg>
    </div>
  );
}

export function GroveChat({
  initialMessages,
  initialExpression,
  initialStep,
  keeperName,
  freshHatch,
  credits,
  initialProfile,
}: {
  initialMessages: KeeperMessage[];
  initialExpression: KeeperExpression;
  initialStep: OnboardingStep;
  keeperName: string | null;
  freshHatch: boolean;
  credits: number;
  initialProfile: UnderstandingProfile | null;
}) {
  const [theme, setTheme] = useState<Theme>('day');
  const [reducedMotion, setReducedMotion] = useState(false);

  const sceneRef = useRef<HTMLDivElement>(null);

  /* Time-of-day palette, set after mount so SSR markup stays stable. */
  useEffect(() => {
    setTheme(themeForHour(new Date().getHours()));
  }, []);

  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    setReducedMotion(mq.matches);
    const onChange = (e: MediaQueryListEvent) => setReducedMotion(e.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  /* Parallax ≤8px, pointer-driven, disabled for reduced motion. */
  const onPointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (reducedMotion || e.pointerType !== 'mouse') return;
      const el = sceneRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const nx = Math.max(-0.5, Math.min(0.5, (e.clientX - rect.left) / rect.width - 0.5));
      const ny = Math.max(-0.5, Math.min(0.5, (e.clientY - rect.top) / rect.height - 0.5));
      el.style.setProperty('--par-x', nx.toFixed(3));
      el.style.setProperty('--par-y', ny.toFixed(3));
    },
    [reducedMotion],
  );

  return (
    <div className={styles.scene} data-theme={theme} ref={sceneRef} onPointerMove={onPointerMove}>
      <SceneLayers />
      <KeeperChat
        variant="focal"
        initialMessages={initialMessages}
        initialExpression={initialExpression}
        initialStep={initialStep}
        keeperName={keeperName}
        freshHatch={freshHatch}
        credits={credits}
        initialProfile={initialProfile}
      />
    </div>
  );
}
