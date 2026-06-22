'use client';

/**
 * Per-nibbin controls:
 *   — Observe / Draft / Act action-level segmented control (Task 7)
 *   — Advisory Agent School grade badge (informational, never gates)
 *   — Non-blocking Act-below-Graduate warning (confirm proceeds, never blocks)
 *   — Pause / Resume (status-based)
 *   — Delete (archive, two-step inline confirm)
 */
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { pauseNibbinAction, resumeNibbinAction, sleepNibbinAction } from './actions';
import { setNibbinActionLevel, type ActionLevel } from './action-level-actions';
import { SegmentedControl } from '../../../components/ui/SegmentedControl';
import { Badge } from '../../../components/ui';
import styles from './nibbins.module.css';

const SYSTEM_PAUSE_LABELS: Record<string, string> = {
  anomaly: 'Paused — anomaly detected',
  cap:     'Paused — credit cap reached',
  connection: 'Paused — connection issue',
};

const ACTION_LEVEL_OPTIONS: Array<{ value: string; label: string; description?: string }> = [
  { value: 'observe', label: 'Observe', description: 'Nibbin watches and learns — no drafts or sends.' },
  { value: 'draft',   label: 'Draft',   description: 'Nibbin prepares drafts for your approval.' },
  { value: 'act',     label: 'Act',     description: 'Nibbin can act on its own after your one-time grant.' },
];

type Stage = 'egg' | 'student' | 'senior' | 'grad';

const STAGE_GRADE_LABEL: Record<Stage, string> = {
  egg:     'Egg',
  student: 'Student',
  senior:  'Senior',
  grad:    'Graduate',
};

interface Props {
  nibbinId: string;
  name: string;
  status: string;
  pausedReason: string | null;
  /** Current action_level (observe/draft/act). Default: 'draft'. */
  actionLevel?: ActionLevel;
  /** Agent School stage — advisory only, never gates action level. */
  stage?: Stage;
  /** % of runs approved as-is in the current promotion window. Null = no data. */
  matchPct?: number | null;
}

export function NibbinControls({
  nibbinId,
  name,
  status,
  pausedReason,
  actionLevel = 'draft',
  stage,
  matchPct,
}: Props) {
  const router = useRouter();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmSend, setConfirmSend] = useState(false);
  const [pendingSendLevel, setPendingSendLevel] = useState<ActionLevel | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [levelPending, startLevelTransition] = useTransition();

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
      if (!res.ok) { setError(res.error ?? "Couldn't delete."); return; }
      setConfirmDelete(false);
      router.refresh();
    });
  }

  function applyLevel(level: ActionLevel) {
    setError(null);
    startLevelTransition(async () => {
      const res = await setNibbinActionLevel(nibbinId, level);
      if (!res.ok) { setError(res.error ?? "Couldn't update action level."); return; }
      router.refresh();
    });
  }

  function handleLevelChange(level: string) {
    // Safe: ACTION_LEVEL_OPTIONS is the only source of values passed to onChange.
    const l = level as ActionLevel;
    // Non-blocking Act warning: if choosing Act and the nibbin is below Graduate,
    // show a confirm. The owner can still proceed — it never blocks.
    if (l === 'act' && stage !== 'grad') {
      setPendingSendLevel(l);
      setConfirmSend(true);
      return;
    }
    applyLevel(l);
  }

  function confirmSendWarning() {
    if (pendingSendLevel) applyLevel(pendingSendLevel);
    setConfirmSend(false);
    setPendingSendLevel(null);
  }

  function cancelSendWarning() {
    setConfirmSend(false);
    setPendingSendLevel(null);
  }

  const isSystemPause = status === 'paused' && pausedReason !== null && pausedReason !== 'user';
  const systemLabel   = isSystemPause ? (SYSTEM_PAUSE_LABELS[pausedReason!] ?? 'Paused') : null;

  // Advisory grade badge text
  const gradeBadgeText = stage
    ? matchPct !== null && matchPct !== undefined
      ? `${STAGE_GRADE_LABEL[stage]} · ${matchPct}% approved as-is`
      : STAGE_GRADE_LABEL[stage]
    : null;

  // Badge tone: grad = moss, senior = honey, student/egg = neutral
  const gradeBadgeTone = stage === 'grad' ? 'moss' : stage === 'senior' ? 'honey' : 'neutral';

  return (
    <span className={styles.draftConfirm}>
      {/* Action level segmented control */}
      <span style={{ display: 'inline-flex', flexDirection: 'column', gap: 6 }}>
        <SegmentedControl
          options={ACTION_LEVEL_OPTIONS}
          value={actionLevel}
          onChange={handleLevelChange}
          disabled={levelPending || pending}
          aria-label="Action level"
        />

        {/* Advisory grade badge — informational only */}
        {gradeBadgeText && (
          <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <Badge tone={gradeBadgeTone} title="Agent School grade — advisory, not a gate">
              {gradeBadgeText}
            </Badge>
          </span>
        )}

        {/* Non-blocking Act-below-Graduate warning */}
        {confirmSend && (
          <span className={styles.draftConfirm} style={{ flexDirection: 'column', alignItems: 'flex-start' }}>
            <span className={styles.draftConfirmTxt}>
              {name} is a {stage ? STAGE_GRADE_LABEL[stage] : 'Student'}
              {matchPct !== null && matchPct !== undefined ? ` (${matchPct}% approved as-is)` : ''} and hasn&rsquo;t graduated yet.
              Act permission is yours to grant, and {name} will act on its own right away. You can dial it back to Draft or Observe anytime.
            </span>
            <span style={{ display: 'flex', gap: 6 }}>
              <button
                type="button"
                className={styles.draftYes}
                onClick={confirmSendWarning}
                disabled={levelPending}
              >
                {levelPending ? 'Saving…' : 'Set to Act anyway'}
              </button>
              <button
                type="button"
                className={styles.draftNo}
                onClick={cancelSendWarning}
                disabled={levelPending}
              >
                Cancel
              </button>
            </span>
          </span>
        )}
      </span>

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
            Delete {name}? It&rsquo;s archived, not erased &mdash; it stops working and leaves your roster.
          </span>
          <button
            type="button"
            className={styles.deleteConfirmYes}
            onClick={handleDelete}
            disabled={pending}
          >
            {pending ? 'Deleting…' : 'Delete'}
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
