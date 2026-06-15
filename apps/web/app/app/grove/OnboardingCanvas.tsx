'use client';

/**
 * OnboardingCanvas — in-shell focal onboarding host (Phase 3).
 *
 * Renders, centered in the shell content area:
 *   1. OnboardingStepper — mapped from the current OnboardingStep
 *   2. KeeperChat variant="focal" — which already renders KeeperSprite + the
 *      full chat engine (including hatch delight, composer, handoff screen).
 *
 * The sprite lives inside KeeperChat (as it did in Phase 1). OnboardingCanvas
 * provides: the stepper, the centered column chrome, and the completion
 * callback that triggers a page refresh so Grove Home re-renders into the
 * done layout (dashboard + docked KeeperPanel).
 *
 * Reduced-motion parity: KeeperChat already handles it; the stepper uses
 * color-only emphasis (no required animation).
 */

import { useCallback, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { KeeperExpression, KeeperMessage, OnboardingStep, UnderstandingProfile } from '@nibbin/keeper';
import { KeeperChat } from './KeeperChat';
import { OnboardingStepper, type StepperStep } from './OnboardingStepper';
import styles from './onboarding-canvas.module.css';

/** Map OnboardingStep → StepperStep for the quiet progress indicator. */
function toStepperStep(step: OnboardingStep): StepperStep {
  switch (step) {
    case 'ask_user_name':
    case 'ask_keeper_name':
      return 'meet';
    case 'understand':
      return 'about';
    case 'done':
      // At 'done' the handoff screen shows ("download the desktop app") → 'desktop'
      return 'desktop';
    default:
      return 'meet';
  }
}

export interface OnboardingCanvasProps {
  initialMessages: KeeperMessage[];
  initialExpression: KeeperExpression;
  initialStep: OnboardingStep;
  keeperName: string | null;
  freshHatch: boolean;
  credits: number;
  initialProfile: UnderstandingProfile | null;
}

export function OnboardingCanvas({
  initialMessages,
  initialExpression,
  initialStep,
  keeperName,
  freshHatch,
  credits,
  initialProfile,
}: OnboardingCanvasProps) {
  const router = useRouter();
  const [stepperStep, setStepperStep] = useState<StepperStep>(toStepperStep(initialStep));
  // Track whether we've already triggered a refresh to avoid double-firing.
  const refreshedRef = useRef(false);

  const handleStep = useCallback(
    (step: OnboardingStep) => {
      setStepperStep(toStepperStep(step));
      if (step === 'done' && !refreshedRef.current) {
        // Minimum-viable dock transition: on completion, navigate so Grove Home
        // re-renders in the done layout (dashboard + docked KeeperPanel).
        // A small delay lets the handoff screen's first paint land before the
        // transition, so the user sees the "You're there!" moment.
        refreshedRef.current = true;
        // We intentionally do NOT redirect immediately — the handoff screen in
        // KeeperChat gives the user download links and a "take me to my grove"
        // link. Let them choose; when they click "Not now — take me to my grove"
        // the router.push('/app') inside KeeperChat handles it. If we forced a
        // refresh here we'd cut off the handoff screen before they read it.
        // So: just update the stepper to 'desktop' (already done above), and
        // rely on the existing "take me to my grove" Link in the handoff panel.
        // The router.refresh() is still called to warm the next render:
        router.refresh();
      }
    },
    [router],
  );

  return (
    <div className={styles.canvas}>
      <div className={styles.column}>
        <OnboardingStepper current={stepperStep} />
        <div className={styles.chatWrap}>
          <KeeperChat
            variant="focal"
            initialMessages={initialMessages}
            initialExpression={initialExpression}
            initialStep={initialStep}
            keeperName={keeperName}
            freshHatch={freshHatch}
            credits={credits}
            initialProfile={initialProfile}
            onStep={handleStep}
          />
        </div>
      </div>
    </div>
  );
}
