'use client';

/**
 * Per-nibbin pause/resume and delete (sleep) controls.
 *
 * Pause / Resume — show when status is active or paused-by-user. If the
 * nibbin is paused by a system reason (anomaly/cap/connection) we show a
 * non-actionable status note instead so the user is informed without a
 * misleading button.
 *
 * Delete — "Archive {name}": opens an inline confirm (destructive, two-step,
 * matching the BackToDrafts pattern). Calls sleepNibbinAction which sets
 * status='sleeping' and kills in-flight runs. The nibbin is never hard-deleted.
 */
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { pauseNibbinAction, resumeNibbinAction, sleepNibbinAction } from './actions';
import styles from './nibbins.module.css';

const SYSTEM_PAUSE_LABELS: Record<string, string> = {
  anomaly: 'Paused — anomaly detected',
  cap:     'Paused — credit cap reached',
  connection: 'Paused — connection issue',
};

interface Props {
  nibbinId: string;
  name: string;
  status: string;
  pausedReason: string | null;
}

export function NibbinControls({ nibbinId, name, status, pausedReason }: Props) {
  const router = useRouter();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function handlePause() {
    setError(null);
    startTransition(async () => {
      const res = await pauseNibbinAction(nibbinId);
      if (!res.ok) { setError(res.error ?? "Couldn't pause."); return; }
      router.refresh();
    });
  }

  function handleResume() {
    setError(null);
    startTransition(async () => {
      const res = await resumeNibbinAction(nibbinId);
      if (!res.ok) { setError(res.error ?? "Couldn't resume."); return; }
      router.refresh();
    });
  }

  function handleDelete() {
    setError(null);
    startTransition(async () => {
      const res = await sleepNibbinAction(nibbinId);
      if (!res.ok) { setError(res.error ?? "Couldn't archive."); return; }
      setConfirmDelete(false);
      router.refresh();
    });
  }

  const isSystemPause = status === 'paused' && pausedReason !== null && pausedReason !== 'user';
  const systemLabel   = isSystemPause ? (SYSTEM_PAUSE_LABELS[pausedReason!] ?? 'Paused') : null;

  return (
    <span className={styles.draftConfirm}>
      {/* Pause / Resume toggle */}
      {isSystemPause ? (
        <span className={styles.draftConfirmTxt}>{systemLabel}</span>
      ) : status === 'active' ? (
        <button
          type="button"
          className={styles.draftBtn}
          onClick={handlePause}
          disabled={pending}
        >
          {pending ? 'Pausing…' : 'Pause'}
        </button>
      ) : status === 'paused' && pausedReason === 'user' ? (
        <button
          type="button"
          className={styles.draftBtn}
          onClick={handleResume}
          disabled={pending}
        >
          {pending ? 'Resuming…' : 'Resume'}
        </button>
      ) : null}

      {/* Delete (sleep) */}
      {!confirmDelete ? (
        <button
          type="button"
          className={styles.deleteBtn}
          onClick={() => { setError(null); setConfirmDelete(true); }}
          disabled={pending}
        >
          Delete
        </button>
      ) : (
        <>
          <span className={styles.draftConfirmTxt}>
            Archive {name}? Any in-progress runs will be stopped. This can&rsquo;t be undone.
          </span>
          <button
            type="button"
            className={styles.deleteConfirmYes}
            onClick={handleDelete}
            disabled={pending}
          >
            {pending ? 'Archiving…' : 'Yes, archive'}
          </button>
          <button
            type="button"
            className={styles.draftNo}
            onClick={() => setConfirmDelete(false)}
            disabled={pending}
          >
            Cancel
          </button>
        </>
      )}

      {error && <span className={styles.err}>{error}</span>}
    </span>
  );
}
