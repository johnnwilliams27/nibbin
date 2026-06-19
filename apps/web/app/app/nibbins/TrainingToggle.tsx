'use client';

/**
 * Training Mode (§18.1) opt-in control. Time-boxed + budget-bounded: enabling it
 * lets the scheduler surface MORE drafts-for-approval during the window so the
 * agent accumulates Agent School's promotion signal faster — it grants NO
 * autonomy and changes no gate (every draft still needs your yes; graduation
 * still takes the same earned approvals). One click to start, one to stop.
 *
 * Eggs are observe-only, and Graduates already act on their own, so training is
 * offered only to Students/Seniors (the stages where more approved drafts move
 * the promotion needle). When a window is open we show its remaining budget +
 * expiry and a one-click "End training".
 */
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { openTrainingAction, closeTrainingAction } from './actions';
import { Tooltip } from '../../../components/ui/Tooltip';
import styles from './nibbins.module.css';

export interface TrainingState {
  active: boolean;
  /** remaining extra-run budget (active windows only). */
  runsRemaining?: number;
  /** epoch ms the window auto-expires (active windows only). */
  expiresAtMs?: number;
}

function expiryLabel(ms: number): string {
  const days = Math.max(0, Math.round((ms - Date.now()) / (24 * 60 * 60 * 1000)));
  if (days >= 1) return `${days} ${days === 1 ? 'day' : 'days'} left`;
  const hours = Math.max(0, Math.round((ms - Date.now()) / (60 * 60 * 1000)));
  return `${hours} ${hours === 1 ? 'hour' : 'hours'} left`;
}

export function TrainingToggle({
  nibbinId,
  name,
  state,
}: {
  nibbinId: string;
  name: string;
  state: TrainingState;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function open() {
    setError(null);
    startTransition(async () => {
      const res = await openTrainingAction(nibbinId);
      if (!res.ok) {
        setError(res.error ?? 'Could not start training.');
        return;
      }
      router.refresh();
    });
  }

  function close() {
    setError(null);
    startTransition(async () => {
      const res = await closeTrainingAction(nibbinId);
      if (!res.ok) {
        setError(res.error ?? 'Could not end training.');
        return;
      }
      router.refresh();
    });
  }

  if (state.active) {
    const parts: string[] = [];
    if (typeof state.runsRemaining === 'number') {
      parts.push(`${state.runsRemaining} ${state.runsRemaining === 1 ? 'run' : 'runs'} left`);
    }
    if (typeof state.expiresAtMs === 'number') parts.push(expiryLabel(state.expiresAtMs));
    return (
      <span style={{ display: 'inline-flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <Tooltip content="Training surfaces more drafts for your review — it never acts on its own.">
          <span className={styles.streak}>
            Training · {parts.join(' · ')}
          </span>
        </Tooltip>
        <button type="button" className={styles.draftBtn} onClick={close} disabled={pending}>
          {pending ? 'Ending…' : 'End training'}
        </button>
        {error && <span className={styles.err}>{error}</span>}
      </span>
    );
  }

  return (
    <span style={{ display: 'inline-flex', gap: 8, alignItems: 'center' }}>
      <Tooltip content={`Surface more drafts from ${name} for your review — speeds up graduation without changing any gate.`}>
        <button
          type="button"
          className={styles.draftBtn}
          onClick={open}
          disabled={pending}
        >
          {pending ? 'Starting…' : 'Train faster'}
        </button>
      </Tooltip>
      {error && <span className={styles.err}>{error}</span>}
    </span>
  );
}
