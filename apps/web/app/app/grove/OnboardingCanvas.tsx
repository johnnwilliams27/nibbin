'use client';

/**
 * OnboardingCanvas — in-shell focal onboarding host (Phase 3).
 *
 * Renders, centered in the shell content area:
 *   1. OnboardingStepper — mapped from the current OnboardingStep
 *   2. KeeperChat variant="focal" — which renders KeeperSprite + the full chat
 *      engine (hatch delight, composer) and, once step === 'done', the NIB-4
 *      next-step affordance below the composer.
 *
 * The sprite lives inside KeeperChat (as it did in Phase 1). OnboardingCanvas
 * provides: the stepper, the centered column chrome, and the completion
 * callback that warms a page refresh so Grove Home re-renders into the
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
import type { ReachMeData } from '../../../lib/privacy/reach-me';
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
      // At 'done' the next-step affordance nudges toward connecting → 'desktop'
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
  /** Server-derived: account has ≥1 `active` connection (NIB-4 next step). */
  hasConnection: boolean;
  /** Reach-me channel state for the focal header button (shown at step==='done'). */
  reachMe: ReachMeData;
}

export function OnboardingCanvas({
  initialMessages,
  initialExpression,
  initialStep,
  keeperName,
  freshHatch,
  credits,
  initialProfile,
  hasConnection,
  reachMe,
}: OnboardingCanvasProps) {
  const router = useRouter();
  const [stepperStep, setStepperStep] = useState<StepperStep>(toStepperStep(initialStep));
  // Track whether we've already triggered a refresh to avoid double-firing.
  const refreshedRef = useRef(false);

  const handleStep = useCallback(
    (step: OnboardingStep) => {
      setStepperStep(toStepperStep(step));
      if (step === 'done' && !refreshedRef.current) {
        // On completion, warm a refresh so Grove Home re-renders into the done
        // layout (dashboard + docked KeeperPanel). We intentionally do NOT
        // redirect: the user stays in the focal canvas, where KeeperChat now
        // shows the NIB-4 next-step affordance below the composer. The refresh
        // just primes the next navigation to /app.
        refreshedRef.current = true;
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
            hasConnection={hasConnection}
            reachMe={reachMe}
            onStep={handleStep}
          />
        </div>
      </div>
    </div>
  );
}
