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

import type { KeeperExpression, KeeperMessage, OnboardingStep, UnderstandingProfile } from '@nibbin/keeper';
import { KeeperChat } from './KeeperChat';
import styles from './keeper-panel.module.css';

export interface KeeperPanelProps {
  initialMessages: KeeperMessage[];
  initialExpression: KeeperExpression;
  initialStep: OnboardingStep;
  keeperName: string | null;
  credits: number;
  initialProfile: UnderstandingProfile | null;
}

export function KeeperPanel({
  initialMessages,
  initialExpression,
  initialStep,
  keeperName,
  credits,
  initialProfile,
}: KeeperPanelProps) {
  return (
    <div className={styles.panel}>
      <header className={styles.header}>
        <span className={styles.avatar} aria-hidden="true">🌱</span>
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
        />
      </div>
    </div>
  );
}
