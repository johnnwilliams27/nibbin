'use client';

/**
 * The ad-hoc ask entry + plan-preview consent gate (Slice 3a, design §2.2/§6).
 *
 * "Ask a Nibbin to look into / handle something" → proposePlan (no run) →
 * a plan-preview card: the goal, the intended narrative steps, the EXACT tool +
 * connector surface the loop is provisioned to, and the standing assurance that
 * nothing sends or leaves without an explicit okay → "Run it" provisions the
 * loop to exactly that surface and starts the supervised run.
 */
import { useState, useTransition, useEffect, useRef } from 'react';
import { Button, Card, Spinner } from '../../../components/ui';
import { proposePlan, startPlanRun } from './actions';
import { PlanRunView } from './PlanRunView';
import type { PlanOutcome, PlanSpec } from '@nibbin/runtime';
import type { PlanPreview } from '../../../lib/planner/plan';
import styles from './planner.module.css';

export function PlanComposer({ initialIntent = '' }: { initialIntent?: string } = {}) {
  const [intent, setIntent] = useState(initialIntent);
  const [proposal, setProposal] = useState<{ plan: PlanSpec; preview: PlanPreview } | null>(null);
  const [outcome, setOutcome] = useState<PlanOutcome | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  // Run-phase step-progress state: which step index is currently "active"
  const [activeStep, setActiveStep] = useState<number>(0);
  const stepTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // Captures the step count when the run begins so the interval closure can reference it.
  const runStepCountRef = useRef<number>(0);
  // Tracks whether a run is in flight as a state boolean so the useEffect can depend on it.
  const [runInFlight, setRunInFlight] = useState(false);
  // The steps shown during the run phase — captured at run() time so they survive proposal clear.
  const runStepsRef = useRef<string[]>([]);

  // While a run is in flight, cycle the active step index every ~4.5 s.
  // Clear the timer when pending stops (run finished or errored) or on unmount.
  useEffect(() => {
    if (!runInFlight || !pending) {
      if (stepTimerRef.current !== null) {
        clearInterval(stepTimerRef.current);
        stepTimerRef.current = null;
      }
      if (!pending) {
        // Run finished — reset so next propose starts clean
        setRunInFlight(false);
      }
      return;
    }
    // Reset to first step when a new run begins
    setActiveStep(0);
    stepTimerRef.current = setInterval(() => {
      setActiveStep((prev) => {
        const max = runStepCountRef.current > 0 ? runStepCountRef.current - 1 : prev;
        return prev < max ? prev + 1 : prev;
      });
    }, 4500);
    return () => {
      if (stepTimerRef.current !== null) {
        clearInterval(stepTimerRef.current);
        stepTimerRef.current = null;
      }
    };

  }, [runInFlight, pending]);

  function propose() {
    setError(null);
    setOutcome(null);
    // Clear any captured run steps from a previous run so phase detection starts fresh.
    runStepsRef.current = [];
    runStepCountRef.current = 0;
    startTransition(async () => {
      const result = await proposePlan(intent);
      if ('error' in result) {
        setError(result.error);
        setProposal(null);
        return;
      }
      setProposal(result);
    });
  }

  function run() {
    if (!proposal) return;
    const plan = proposal.plan;
    // Capture steps before clearing the proposal so they survive the transition.
    runStepsRef.current = proposal.preview.intendedSteps;
    runStepCountRef.current = proposal.preview.intendedSteps.length;
    setError(null);
    setActiveStep(0);
    setRunInFlight(true);
    startTransition(async () => {
      const result = await startPlanRun(plan);
      if ('error' in result) {
        setError(result.error);
        setRunInFlight(false);
        return;
      }
      setProposal(null);
      setOutcome(result);
      setRunInFlight(false);
    });
  }

  // Propose phase: pending and run has not been kicked off
  const isProposePhase = pending && !runInFlight;
  // Run phase: explicitly flagged by run(), cleared on completion or error
  const isRunPhase = runInFlight && pending;

  return (
    <div>
      <div className={styles.askRow}>
        <textarea
          className={styles.askInput}
          value={intent}
          onChange={(e) => setIntent(e.target.value)}
          placeholder="Ask a Nibbin to look into or handle something — e.g. “tell me what needs my attention today”"
          disabled={pending}
        />
        <div className={styles.actions}>
          <Button onClick={propose} disabled={pending || intent.trim() === ''}>
            {pending && !proposal ? "Thinking…" : "Make a plan"}
          </Button>
        </div>
      </div>

      {/* Propose phase thinking indicator — appears below the textarea while proposePlan is in flight */}
      {isProposePhase ? (
        <div className={styles.thinkingRow} role="status" aria-live="polite">
          <Spinner label="Planning" />
          <span className={styles.thinkingLabel}>Planning…</span>
        </div>
      ) : null}

      {error ? <p className={styles.error}>{error}</p> : null}

      {/* Proposal preview — hidden once a run is in flight to avoid overlapping step lists */}
      {proposal && !isRunPhase ? (
        <Card className={styles.previewCard}>
          <p className={styles.eyebrow}>{"Here’s the plan"}</p>
          <p className={styles.previewGoal}>{proposal.preview.goal}</p>
          {proposal.preview.intendedSteps.length > 0 ? (
            <ul className={styles.stepList}>
              {proposal.preview.intendedSteps.map((s, i) => (
                <li key={i}>{s}</li>
              ))}
            </ul>
          ) : null}

          <p className={styles.surfaceLabel}>What it can use</p>
          <p className={styles.sub}>{proposal.preview.surface.join(', ')}</p>

          {proposal.preview.connectorsNeeded.length > 0 ? (
            <>
              <p className={styles.surfaceLabel}>Connections it needs</p>
              <p className={styles.sub}>{proposal.preview.connectorsNeeded.join(', ')}</p>
            </>
          ) : null}

          <p className={styles.assurance}>
            Nothing sends or leaves without your okay — every step that would act pauses for your approval first.
          </p>

          <div className={styles.actions}>
            <Button onClick={run} disabled={pending}>
              {pending ? "Starting…" : "Run it"}
            </Button>
            <Button variant="ghost" onClick={() => setProposal(null)} disabled={pending}>
              Cancel
            </Button>
          </div>
        </Card>
      ) : null}

      {/* Run phase step-progress — replaces the proposal card while startPlanRun is in flight */}
      {isRunPhase && runStepsRef.current.length > 0 ? (
        <div className={styles.runProgress} role="status" aria-live="polite" aria-label="Running plan">
          <p className={styles.eyebrow}>Working through the plan</p>
          <ul className={styles.progressStepList}>
            {runStepsRef.current.map((step, i) => {
              const isDone = i < activeStep;
              const isActive = i === activeStep;
              return (
                <li
                  key={i}
                  className={
                    isActive
                      ? styles.stepActive
                      : isDone
                      ? styles.stepDone
                      : styles.stepPending
                  }
                >
                  {isActive ? (
                    <span className={styles.stepSpinner}>
                      <Spinner label="Running" />
                    </span>
                  ) : isDone ? (
                    <span className={styles.stepCheck} aria-hidden="true">{"✓"}</span>
                  ) : (
                    <span className={styles.stepDot} aria-hidden="true" />
                  )}
                  <span>{step}</span>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}

      {outcome ? <PlanRunView initial={outcome} /> : null}
    </div>
  );
}
