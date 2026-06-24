'use client';

/**
 * ReachMeButton — the paper-plane trigger for "Reach me on the go".
 *
 * Lives in the Keeper panel header (between .headerText and .credits) and in
 * the focal header's .headerRight cluster. The HOST gates it on step === 'done'
 * (mirroring OnboardingNextStep), so this component never renders mid-onboarding.
 *
 * Opens ReachMeModal (lazy-rendered only when open). All connect/disconnect/
 * save plumbing lives in the modal via the existing privacy server actions.
 */

import { useState } from 'react';
import { ReachMeModal, REACH_ME_TITLE } from './ReachMeModal';
import type { ReachMeData } from '../../../lib/privacy/reach-me';
import styles from './reach-me.module.css';

export interface ReachMeButtonProps {
  reachMe: ReachMeData;
  /** Optional extra class so each host can position the trigger in its header. */
  className?: string;
}

function PaperPlane() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M21.5 3.5 2.5 11.2c-.7.3-.7 1.2.05 1.4l5.6 1.7 2.1 5.9c.25.7 1.2.75 1.5.07l2.1-4.6 4.6 4.1c.5.45 1.3.18 1.45-.47L22.9 4.5c.16-.7-.5-1.3-1.4-1Z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      <path
        d="m8.2 14.3 9.6-8.2"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function ReachMeButton({ reachMe, className }: ReachMeButtonProps) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        className={[styles.trigger, className].filter(Boolean).join(' ')}
        aria-label={REACH_ME_TITLE}
        title={REACH_ME_TITLE}
        aria-haspopup="dialog"
        onClick={() => setOpen(true)}
      >
        <PaperPlane />
      </button>
      {open && (
        <ReachMeModal
          channels={reachMe.channels}
          botHandle={reachMe.botHandle}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}
