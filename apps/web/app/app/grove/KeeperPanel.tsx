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

import { Grovekeeper } from '../../../components/grovekeeper/Grovekeeper';
import type { KeeperExpression, KeeperMessage, OnboardingStep, UnderstandingProfile } from '@nibbin/keeper';
import { KeeperChat, type Celebration } from './KeeperChat';
import { ReachMeButton } from './ReachMeButton';
import type { ReachMeData } from '../../../lib/privacy/reach-me';
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
  /** Reach-me channel state for the "Reach me on the go" header button. */
  reachMe: ReachMeData;
  /**
   * Close the panel. On mobile (bottom sheet) a ✕ button in the header calls
   * this; on desktop the header close button is hidden via CSS and the
   * collapse rail handles dismissal. Optional so the panel can render
   * standalone (e.g. in tests/storybook) without a handler.
   */
  onClose?: () => void;
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
  reachMe,
  onClose,
}: KeeperPanelProps) {
  return (
    <div className={styles.panel}>
      <header className={styles.header}>
        <span className={styles.avatar} aria-hidden="true">
          <span className={styles.avatarCreature}>
            <Grovekeeper size={30} />
          </span>
        </span>
        <div className={styles.headerText}>
          <p className={styles.eyebrow}>Your Keeper</p>
          <p className={styles.name}>{keeperName ?? 'Your Grovekeeper'}</p>
        </div>
        {/* "Reach me on the go" — only in the settled state, never mid-onboarding
            (mirrors how OnboardingNextStep gates on step === 'done'). */}
        {initialStep === 'done' && <ReachMeButton reachMe={reachMe} />}
        <p className={styles.credits}>
          <span className={styles.creditsValue}>{credits}</span>
          {' '}cr
        </p>
        {/* Mobile-only close ✕ — hidden on desktop via CSS. Lives in the header
            (top-right) so it never overlaps the chat input's Send button. */}
        {onClose && (
          <button
            type="button"
            className={styles.closeBtn}
            aria-label="Close Keeper"
            onClick={onClose}
          >
            ✕
          </button>
        )}
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
