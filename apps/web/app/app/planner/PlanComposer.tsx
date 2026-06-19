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
import { useState, useTransition } from 'react';
import { Badge, Button, Card } from '../../../components/ui';
import { proposePlan, startPlanRun } from './actions';
import { PlanRunView } from './PlanRunView';
import type { PlanOutcome, PlanSpec } from '@nibbin/runtime';
import type { PlanPreview } from '../../../lib/planner/plan';
import styles from './planner.module.css';

export function PlanComposer() {
  const [intent, setIntent] = useState('');
  const [proposal, setProposal] = useState<{ plan: PlanSpec; preview: PlanPreview } | null>(null);
  const [outcome, setOutcome] = useState<PlanOutcome | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function propose() {
    setError(null);
    setOutcome(null);
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
    setError(null);
    startTransition(async () => {
      const result = await startPlanRun(plan);
      if ('error' in result) {
        setError(result.error);
        return;
      }
      setProposal(null);
      setOutcome(result);
    });
  }

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
            {pending && !proposal ? 'Thinking…' : 'Make a plan'}
          </Button>
        </div>
      </div>

      {error ? <p className={styles.error}>{error}</p> : null}

      {proposal ? (
        <Card className={styles.previewCard}>
          <p className={styles.eyebrow}>Here's the plan</p>
          <p className={styles.previewGoal}>{proposal.preview.goal}</p>
          {proposal.preview.intendedSteps.length > 0 ? (
            <ul className={styles.stepList}>
              {proposal.preview.intendedSteps.map((s, i) => (
                <li key={i}>{s}</li>
              ))}
            </ul>
          ) : null}

          <p className={styles.surfaceLabel}>What it can use</p>
          <div className={styles.chips}>
            {proposal.preview.surface.map((t) => (
              <Badge key={t} tone="moss">
                {t}
              </Badge>
            ))}
          </div>

          {proposal.preview.connectorsNeeded.length > 0 ? (
            <>
              <p className={styles.surfaceLabel}>Connections it needs</p>
              <div className={styles.chips}>
                {proposal.preview.connectorsNeeded.map((c) => (
                  <Badge key={c} tone="sky">
                    {c}
                  </Badge>
                ))}
              </div>
            </>
          ) : null}

          <p className={styles.assurance}>
            Nothing sends or leaves without your okay — every step that would act pauses for your approval first.
          </p>

          <div className={styles.actions}>
            <Button onClick={run} disabled={pending}>
              {pending ? 'Starting…' : 'Run it'}
            </Button>
            <Button variant="ghost" onClick={() => setProposal(null)} disabled={pending}>
              Cancel
            </Button>
          </div>
        </Card>
      ) : null}

      {outcome ? <PlanRunView initial={outcome} /> : null}
    </div>
  );
}
