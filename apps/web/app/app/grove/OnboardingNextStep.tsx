'use client';

/**
 * OnboardingNextStep — the persistent first-connection next-step affordance (NIB-4).
 *
 * Shown at step === 'done', rendered by the host chat surface BELOW the composer
 * (never inside the role="log" scroll region — that preserves the KeeperChat
 * bottom-anchoring fix). Only the 'connect' stage remains on this surface:
 *
 *   - stage 1 (`'connect'`): no active connection yet → link to /app/connections.
 *     Stays until an active connection exists (server-derived `hasConnection`).
 *
 * The field-study stage is now delivered as a notification-centre leaf, emitted
 * at onboarding completion by `emitOnboardingLeaves` in grove/actions.ts.
 *
 * `hasConnection` is computed server-side (an `active` row in the `connections`
 * table for the account) and threaded down.
 */

import Link from 'next/link';
import { NEXT_STEP } from '@nibbin/keeper';
import styles from './onboarding-next-step.module.css';

export interface OnboardingNextStepProps {
  /** Server-derived: does the account have at least one `active` connection? */
  hasConnection: boolean;
}

export function OnboardingNextStep({ hasConnection }: OnboardingNextStepProps) {
  // The field-study stage now lives in the notification centre (a leaf).
  // Only show the connect nudge when the account has no active connection yet.
  if (hasConnection) return null;

  return (
    <aside className={styles.root} aria-label="Next step">
      <p className={styles.title}>{NEXT_STEP.connect.title}</p>
      <p className={styles.detail}>{NEXT_STEP.connect.detail}</p>
      <Link className={styles.cta} href="/app/connections">
        {NEXT_STEP.connect.cta} <span aria-hidden="true">→</span>
      </Link>
    </aside>
  );
}
