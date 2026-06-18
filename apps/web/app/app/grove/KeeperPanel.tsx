'use client';

/**
 * KeeperPanel — the docked daily Keeper companion (§Phase 2).
 *
 * Renders a panel header (keeper avatar + name) followed by
 * <KeeperChat variant="panel"> in compact mode. Designed to live inside
 * AppShell's `panel` slot: 380px rail on desktop, full-width bottom sheet
 * on mobile.
 *
 * The big hatch/egg theatrics are absent here (freshHatch={false}) — the
 * Keeper is already known; the header avatar is a small static placeholder.
 */

import { useEffect, useMemo, useState } from 'react';
import { buildCreature } from '@nibbin/creatures';
import type { KeeperExpression, KeeperMessage, OnboardingStep, UnderstandingProfile } from '@nibbin/keeper';
import { KeeperChat, type Celebration } from './KeeperChat';
import styles from './keeper-panel.module.css';

export interface KeeperPanelProps {
  initialMessages: KeeperMessage[];
  initialExpression: KeeperExpression;
  initialStep: OnboardingStep;
  keeperName: string | null;
  credits: number;
  initialProfile: UnderstandingProfile | null;
  /** Server-derived: account has ≥1 `active` connection (NIB-4 next step). */
  hasConnection: boolean;
  /** Recent promotions to celebrate in-grove (Beat 3). */
  pendingCelebrations: Celebration[];
}

export function KeeperPanel({
  initialMessages,
  initialExpression,
  initialStep,
  keeperName,
  credits,
  initialProfile,
  hasConnection,
  pendingCelebrations,
}: KeeperPanelProps) {
  // The creature engine mints unique gradient ids per render, so SSR + hydration
  // can't match — mount-gate it (same pattern as KeeperSprite).
  const keeperSvg = useMemo(() => buildCreature({ species: 'Keeper', size: 30 }), []);
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  return (
    <div className={styles.panel}>
      <header className={styles.header}>
        <span className={styles.avatar} aria-hidden="true">
          {mounted ? (
            <span className={styles.avatarCreature} dangerouslySetInnerHTML={{ __html: keeperSvg }} />
          ) : null}
        </span>
        <div className={styles.headerText}>
          <p className={styles.eyebrow}>Your Keeper</p>
          <p className={styles.name}>{keeperName ?? 'Your Grovekeeper'}</p>
        </div>
        <p className={styles.credits}>
          <span className={styles.creditsValue}>{credits}</span>
          {' '}cr
        </p>
      </header>

      <div className={styles.chatWrap}>
        <KeeperChat
          variant="panel"
          initialMessages={initialMessages}
          initialExpression={initialExpression}
          initialStep={initialStep}
          keeperName={keeperName}
          freshHatch={false}
          credits={credits}
          initialProfile={initialProfile}
          hasConnection={hasConnection}
          pendingCelebrations={pendingCelebrations}
        />
      </div>
    </div>
  );
}
