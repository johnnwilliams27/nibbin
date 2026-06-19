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
import { respondToPlanRun, proposeCrystal } from './actions';
import { CrystalPreview } from './CrystalPreview';
import type { CrystalProposeResult } from './actions';
import type { CrystalActionRefusal } from './actions';
import type { PlanOutcome } from '@nibbin/runtime';
import styles from './planner.module.css';

/** Friendly, calm explanation per refusal reason — the gate is the authority;
 *  the UI never pre-judges, it just relays the reason in plain language. */
const REFUSAL_COPY: Record<CrystalActionRefusal, string> = {
  not_done: "This run didn't finish, so there's nothing to make recurring yet.",
  no_action:
    "This one only looked things up — there's nothing to repeat. It's better to re-run it when you need it.",
  utility_in_path:
    "This one needed live web lookups or a judgment call, so it's better to re-run it when you need it.",
  branching:
    "This run made decisions along the way that wouldn't repeat the same. It's better to re-run it when you need it.",
  ungeneralizable:
    "This run did something one-off that wouldn't make sense on a schedule. It's better to re-run it when you need it.",
  invalid_spec: "This run can't safely become a recurring agent.",
  not_found: "We couldn't find that run.",
  bad_cadence: 'Pick a valid cadence.',
};

type CrystalProposal = Exclude<CrystalProposeResult, { refused: true }>;
type CrystalState =
  | { phase: 'idle' }
  | { phase: 'refused'; reason: CrystalActionRefusal }
  | { phase: 'preview'; result: CrystalProposal };

export function PlanRunView({ initial }: { initial: PlanOutcome }) {
  const [outcome, setOutcome] = useState<PlanOutcome>(initial);
  const [answer, setAnswer] = useState('');
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [crystal, setCrystal] = useState<CrystalState>({ phase: 'idle' });

  function makeRecurring() {
    setError(null);
    startTransition(async () => {
      try {
        const result = await proposeCrystal(outcome.runId);
        if ('refused' in result) {
          setCrystal({ phase: 'refused', reason: result.reason });
          return;
        }
        setCrystal({ phase: 'preview', result });
      } catch {
        setError('Something went wrong setting that up.');
      }
    });
  }

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
      <>
        <Card className={styles.previewCard}>
          <p className={styles.eyebrow}>Done</p>
          <pre className={styles.turnObs}>{JSON.stringify(outcome.artifact, null, 2)}</pre>
          {crystal.phase === 'idle' ? (
            <div className={styles.actions}>
              <Button variant="secondary" onClick={makeRecurring} disabled={pending}>
                {pending ? 'Thinking…' : 'Make this recurring'}
              </Button>
            </div>
          ) : null}
          {crystal.phase === 'refused' ? (
            <p className={styles.sub}>{REFUSAL_COPY[crystal.reason]}</p>
          ) : null}
          {error ? <p className={styles.error}>{error}</p> : null}
        </Card>
        {crystal.phase === 'preview' ? (
          <CrystalPreview
            planRunId={outcome.runId}
            preview={crystal.result.preview}
            defaultName={crystal.result.spec.displayName}
          />
        ) : null}
      </>
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
