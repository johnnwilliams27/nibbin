'use client';

/**
 * The supervised run view (Slice 3a, design §6): the live outcome of a plan
 * run. A `needs_input` pause renders either the awaiting-approval draft (with
 * approve / not yet) or the ask-human question (with a response field);
 * resolving it resumes the run. A `done` shows the artifact; killed/failed show
 * a calm line. Tokens-only, no coral.
 */
import { useState, useTransition } from 'react';
import { Button, Card } from '../../../components/ui';
import { respondToPlanRun } from './actions';
import type { PlanOutcome } from '@nibbin/runtime';
import styles from './planner.module.css';

export function PlanRunView({ initial }: { initial: PlanOutcome }) {
  const [outcome, setOutcome] = useState<PlanOutcome>(initial);
  const [answer, setAnswer] = useState('');
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function resolve(response: Parameters<typeof respondToPlanRun>[1]) {
    setError(null);
    startTransition(async () => {
      try {
        const next = await respondToPlanRun(outcome.runId, response);
        setOutcome(next);
        setAnswer('');
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Something went wrong resuming the run.');
      }
    });
  }

  if (outcome.kind === 'done') {
    return (
      <Card className={styles.previewCard}>
        <p className={styles.eyebrow}>Done</p>
        <pre className={styles.turnObs}>{JSON.stringify(outcome.artifact, null, 2)}</pre>
      </Card>
    );
  }

  if (outcome.kind === 'failed') {
    return (
      <Card className={styles.previewCard}>
        <p className={styles.eyebrow}>Stopped</p>
        <p className={styles.sub}>{outcome.error}</p>
      </Card>
    );
  }

  if (outcome.kind === 'killed') {
    return (
      <Card className={styles.previewCard}>
        <p className={styles.eyebrow}>Paused</p>
        <p className={styles.sub}>
          This run reached a safe limit ({outcome.reason.replace('_', ' ')}) and stopped on its own — nothing was sent.
        </p>
      </Card>
    );
  }

  // needs_input
  const req = outcome.request;
  return (
    <Card className={`${styles.previewCard} ${styles.pausePanel}`}>
      {req.kind === 'approval' ? (
        <>
          <p className={styles.eyebrow}>Waiting for your okay</p>
          <p className={styles.pauseQ}>{req.question}</p>
          {typeof req.context.draft === 'string' && req.context.draft ? (
            <p className={styles.turnObs}>{req.context.draft}</p>
          ) : null}
          <p className={styles.assurance}>Nothing sends until you approve it.</p>
          <div className={styles.actions}>
            <Button onClick={() => resolve({ requestId: req.requestId, approval: 'approved' })} disabled={pending}>
              Approve
            </Button>
            <Button variant="ghost" onClick={() => resolve({ requestId: req.requestId, approval: 'rejected' })} disabled={pending}>
              Not yet
            </Button>
          </div>
        </>
      ) : (
        <>
          <p className={styles.eyebrow}>A quick question</p>
          <p className={styles.pauseQ}>{req.question}</p>
          <div className={styles.respondRow}>
            <input
              className={styles.respondInput}
              value={answer}
              onChange={(e) => setAnswer(e.target.value)}
              placeholder="Type your answer"
              disabled={pending}
            />
            <Button
              onClick={() => resolve({ requestId: req.requestId, value: answer.trim() })}
              disabled={pending || answer.trim() === ''}
            >
              Send
            </Button>
          </div>
        </>
      )}
      {error ? <p className={styles.error}>{error}</p> : null}
    </Card>
  );
}
