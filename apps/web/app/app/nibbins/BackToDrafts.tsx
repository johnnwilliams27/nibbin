'use client';

/**
 * CE5 — "Back to drafts" control for a Senior/Graduate Nibbin.
 * Calm, never destructive: a restrained two-step inline confirm (no coral), then
 * the demoteNibbinAction server action runs the member-checked nibbin_demote RPC
 * and drops the dignified demotion leaf. On success the server action already
 * revalidated; we router.refresh() to reflect the new (lower) stage.
 */
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { demoteNibbinAction } from './actions';
import styles from './nibbins.module.css';

export function BackToDrafts({ nibbinId, name }: { nibbinId: string; name: string }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function run() {
    setError(null);
    startTransition(async () => {
      const res = await demoteNibbinAction(nibbinId);
      if (!res.ok) {
        setError(res.error ?? 'Could not move back to drafts.');
        return;
      }
      setConfirming(false);
      router.refresh();
    });
  }

  if (!confirming) {
    return (
      <button
        type="button"
        className={styles.draftBtn}
        onClick={() => {
          setError(null);
          setConfirming(true);
        }}
      >
        Back to drafts
      </button>
    );
  }

  return (
    <span className={styles.draftConfirm}>
      <span className={styles.draftConfirmTxt}>
        Put {name} back to drafts? She&rsquo;ll re-earn the step.
      </span>
      <button type="button" className={styles.draftYes} onClick={run} disabled={pending}>
        {pending ? 'Moving…' : 'Yes, back to drafts'}
      </button>
      <button
        type="button"
        className={styles.draftNo}
        onClick={() => setConfirming(false)}
        disabled={pending}
      >
        Cancel
      </button>
      {error && <span className={styles.err}>{error}</span>}
    </span>
  );
}
