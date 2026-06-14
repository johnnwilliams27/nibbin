'use client';

/**
 * OnboardingStepper — quiet, on-brand progress indicator for first-run onboarding.
 *
 * Four segments: Meet your Keeper · About you · Set up the app · You're live.
 * The active step is emphasized with --moss; prior steps are completed (--moss at
 * lower opacity); future steps are muted (--line / --ink-soft).
 *
 * Reduced-motion safe: no required animation — the emphasis is purely via color
 * and weight, not transforms.
 */

import styles from './stepper.module.css';

export type StepperStep = 'meet' | 'about' | 'desktop' | 'live';

const STEPS: { key: StepperStep; label: string }[] = [
  { key: 'meet', label: 'Meet your Keeper' },
  { key: 'about', label: 'About you' },
  { key: 'desktop', label: 'Set up the app' },
  { key: 'live', label: "You're live" },
];

const ORDER: StepperStep[] = ['meet', 'about', 'desktop', 'live'];

export function OnboardingStepper({ current }: { current: StepperStep }) {
  const currentIndex = ORDER.indexOf(current);

  return (
    <nav className={styles.stepper} aria-label="Onboarding progress">
      <ol className={styles.list}>
        {STEPS.map((step, i) => {
          const isDone = i < currentIndex;
          const isActive = i === currentIndex;
          return (
            <li
              key={step.key}
              className={`${styles.step} ${isActive ? styles.stepActive : ''} ${isDone ? styles.stepDone : ''}`}
              aria-current={isActive ? 'step' : undefined}
            >
              <span className={styles.dot} aria-hidden="true" />
              <span className={styles.label}>{step.label}</span>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
