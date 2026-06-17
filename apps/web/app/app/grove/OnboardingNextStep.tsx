'use client';

/**
 * OnboardingNextStep — the persistent first-connection next-step affordance (NIB-4).
 *
 * Shown at step === 'done', rendered by the host chat surface BELOW the composer
 * (never inside the role="log" scroll region — that preserves the KeeperChat
 * bottom-anchoring fix). It is one affordance with two stages, selected by the
 * pure `nextStepStage` helper:
 *
 *   - stage 1 (`'connect'`): no active connection yet → link to /app/connections.
 *     Stays until an active connection exists (server-derived `hasConnection`).
 *   - stage 2 (`'field-study'`): connected → nudge toward the desktop field study,
 *     reusing the existing Grove Home download card (`/app#download`). Per
 *     Decision C, stage 2 clears when the user clicks through OR dismisses it —
 *     a client-side persisted flag (localStorage `nibbin.onboardingFieldStudyDone`).
 *   - `'none'`: connected AND the field-study nudge satisfied → renders nothing.
 *
 * `hasConnection` is computed server-side (an `active` row in the `connections`
 * table for the account) and threaded down. The field-study "done" flag is
 * purely client-side — there is no web-visible "study started" signal, and the
 * owner chose not to gate on study completion.
 */

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { NEXT_STEP, nextStepStage } from '@nibbin/keeper';
import styles from './onboarding-next-step.module.css';

export const FIELD_STUDY_DONE_KEY = 'nibbin.onboardingFieldStudyDone';

export interface OnboardingNextStepProps {
  /** Server-derived: does the account have at least one `active` connection? */
  hasConnection: boolean;
}

export function OnboardingNextStep({ hasConnection }: OnboardingNextStepProps) {
  // Mount-gate the localStorage read so SSR and the first client render agree
  // (the flag isn't available server-side). Before mount we treat the flag as
  // false, which is the correct default for a user who hasn't acted yet.
  const [fieldStudyDone, setFieldStudyDone] = useState(false);
  useEffect(() => {
    try {
      if (window.localStorage.getItem(FIELD_STUDY_DONE_KEY) === '1') {
        setFieldStudyDone(true);
      }
    } catch {
      // localStorage can throw (privacy mode / disabled) — degrade to "not done".
    }
  }, []);

  const markFieldStudyDone = useCallback(() => {
    setFieldStudyDone(true);
    try {
      window.localStorage.setItem(FIELD_STUDY_DONE_KEY, '1');
    } catch {
      // Best-effort persistence; the in-session state flip still hides it.
    }
  }, []);

  const stage = nextStepStage(hasConnection, fieldStudyDone);
  if (stage === 'none') return null;

  if (stage === 'connect') {
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

  // stage === 'field-study'
  return (
    <aside className={styles.root} aria-label="Next step">
      <p className={styles.title}>{NEXT_STEP.fieldStudy.title}</p>
      <p className={styles.detail}>{NEXT_STEP.fieldStudy.detail}</p>
      <div className={styles.actions}>
        {/* Interim target: the existing desktop download card on Grove Home.
            NIB-2 owns the real start flow; only this href changes when it lands.
            Clicking through counts as satisfying the nudge (Decision C). */}
        <Link className={styles.cta} href="/app#download" onClick={markFieldStudyDone}>
          {NEXT_STEP.fieldStudy.cta} <span aria-hidden="true">→</span>
        </Link>
        <button type="button" className={styles.dismiss} onClick={markFieldStudyDone}>
          {NEXT_STEP.fieldStudy.dismiss}
        </button>
      </div>
    </aside>
  );
}
