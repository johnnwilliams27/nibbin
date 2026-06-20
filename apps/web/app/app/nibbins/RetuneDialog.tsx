'use client';

/**
 * RetuneDialog — lets the user edit a live Nibbin's spec (steps + persona +
 * display name), producing a new immutable spec version (SPEC §18.2 / R52 Slice 1).
 *
 * Editor scope: edit the display name + reorder/remove steps (the same surface
 * the Composer review lets a user tweak). The composer step-editor components
 * are tightly coupled to the DiagnosisWorkflow context, so we fall back to a
 * simpler but complete editor here — name text field, step-by-step list with
 * remove and reorder controls. The versioning machinery (validation gate →
 * retune_nibbin RPC → new immutable spec) is what this slice ships end-to-end.
 *
 * Styling mirrors NibbinEditor.tsx: same overlay/panel/panelHead/panelFoot/err
 * CSS module tokens, same confirm-button hierarchy, same error surface.
 */

import { useState, useEffect, useCallback, useTransition } from 'react';
import { createPortal } from 'react-dom';
import { useRouter } from 'next/navigation';
import { loadCurrentSpecForRetune, retuneNibbin } from './[id]/retune-actions';
import type { CurrentSpec, RetuneEdit } from './[id]/retune-actions';
import type { AgentSpec } from '@nibbin/runtime';
import styles from './nibbins.module.css';

/* ── Types ─────────────────────────────────────────────────────────────────── */

export interface RetuneTriggerProps {
  nibbinId: string;
  nibbinName: string;
}

/* ── Helpers ────────────────────────────────────────────────────────────────── */

/** Friendly display name for a capability id. Mirrors PRIMITIVE_NAME in compose.ts. */
const PRIMITIVE_LABEL: Record<string, string> = {
  'nudge.overdue-email': 'Overdue follow-ups',
  'nudge.overdue-invoice': 'Invoice nudges',
  'nudge.unconfirmed-event': 'Booking confirmations',
  'reply.new-inquiry': 'New-inquiry replies',
  'digest.inbox-cleanup': 'Morning inbox sweep',
  'digest.morning': 'Morning brief',
};

function stepLabel(capability: string): string {
  return PRIMITIVE_LABEL[capability] ?? capability;
}

type EditableStep = NonNullable<AgentSpec['steps']>[number];

/* ── Sub-components ────────────────────────────────────────────────────────── */

/** Single editable step row: label + move-up / remove controls. */
function StepRow({
  step,
  idx,
  total,
  onRemove,
  onMoveUp,
}: {
  step: EditableStep;
  idx: number;
  total: number;
  onRemove: (idx: number) => void;
  onMoveUp: (idx: number) => void;
}) {
  return (
    <div className={styles.stepRow}>
      <span className={styles.stepLabel}>{stepLabel(step.capability)}</span>
      <span className={styles.stepActions}>
        {idx > 0 && (
          <button
            type="button"
            className={styles.stepBtn}
            title="Move up"
            aria-label={`Move ${stepLabel(step.capability)} up`}
            onClick={() => onMoveUp(idx)}
          >
            ↑
          </button>
        )}
        {total > 1 && (
          <button
            type="button"
            className={styles.stepBtn}
            title="Remove step"
            aria-label={`Remove ${stepLabel(step.capability)}`}
            onClick={() => onRemove(idx)}
          >
            ×
          </button>
        )}
      </span>
    </div>
  );
}

/* ── Main dialog ───────────────────────────────────────────────────────────── */

export function RetuneDialog({ nibbinId, nibbinName }: RetuneTriggerProps) {
  const router = useRouter();
  const [mounted, setMounted] = useState(false);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);
  const [seeded, setSeeded] = useState<CurrentSpec | null>(null);
  const [displayName, setDisplayName] = useState('');
  const [steps, setSteps] = useState<EditableStep[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [isPending, startTransition] = useTransition();

  /** Open the dialog by loading the current spec. */
  const handleOpen = useCallback(async () => {
    setLoading(true);
    setError(null);
    setSuccess(false);

    const result = await loadCurrentSpecForRetune(nibbinId);

    if ('error' in result) {
      setError(result.error);
      setLoading(false);
      return;
    }

    setSeeded(result);
    setDisplayName(result.displayName);
    setSteps([...(result.steps ?? [])]);
    setOpen(true);
    setLoading(false);
  }, [nibbinId]);

  function handleClose() {
    setOpen(false);
    setError(null);
    setSuccess(false);
    setSeeded(null);
  }

  function handleRemoveStep(idx: number) {
    setSteps((prev) => prev.filter((_, i) => i !== idx));
  }

  function handleMoveUp(idx: number) {
    if (idx === 0) return;
    setSteps((prev) => {
      const next = [...prev];
      [next[idx - 1], next[idx]] = [next[idx]!, next[idx - 1]!];
      return next;
    });
  }

  /** Confirm: call retuneNibbin, close on success, refresh. */
  function handleConfirm() {
    if (!seeded) return;

    const edit: RetuneEdit = {
      displayName: displayName.trim() || seeded.displayName,
      steps,
      personaPolicy: seeded.personaPolicy,
    };

    startTransition(async () => {
      setError(null);
      const result = await retuneNibbin(nibbinId, edit);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setSuccess(true);
      // Brief success flash, then close + refresh so the page shows v{N}.
      setTimeout(() => {
        setOpen(false);
        setSuccess(false);
        router.refresh();
      }, 900);
    });
  }

  const isBusy = loading || isPending;
  const canConfirm = !isBusy && steps.length > 0 && !success;

  return (
    <>
      <button
        type="button"
        className={styles.editBtn}
        onClick={handleOpen}
        disabled={loading}
        aria-label={`Tune ${nibbinName}`}
      >
        {loading ? 'Loading…' : 'Tune'}
      </button>

      {/* Inline error before dialog opens (e.g. load failure). */}
      {!open && error && (
        <div className={styles.err} role="alert">
          {error}
        </div>
      )}

      {open && seeded && mounted && createPortal(
        <div
          className={styles.overlay}
          role="dialog"
          aria-modal="true"
          aria-label={`Tune ${nibbinName}`}
          onClick={(e) => {
            if (e.target === e.currentTarget && !isBusy) handleClose();
          }}
        >
          <div className={styles.panel}>
            {/* Header */}
            <div className={styles.panelHead}>
              <div>
                <h3 className={styles.panelTitle}>Tune {nibbinName}</h3>
                <div className={styles.panelSub}>
                  Currently{' '}
                  <span className={styles.vBadge}>v{seeded.version}</span>
                  {' '}· saving creates{' '}
                  <span className={styles.vBadge}>v{seeded.version + 1}</span>
                </div>
              </div>
            </div>

            {/* Display name */}
            <div className={styles.field}>
              <label className={styles.label} htmlFor={`retune-name-${nibbinId}`}>
                Agent name
              </label>
              <input
                id={`retune-name-${nibbinId}`}
                className={styles.nameInput}
                value={displayName}
                maxLength={40}
                onChange={(e) => setDisplayName(e.target.value)}
                disabled={isBusy}
              />
            </div>

            {/* Steps editor */}
            <div className={styles.field}>
              <span className={styles.label}>Steps</span>
              {steps.length === 0 ? (
                <p className={styles.stepEmpty}>
                  No steps remaining — at least one step is required to save.
                </p>
              ) : (
                <div className={styles.stepList}>
                  {steps.map((step, idx) => (
                    <StepRow
                      key={`${step.capability}-${idx}`}
                      step={step}
                      idx={idx}
                      total={steps.length}
                      onRemove={handleRemoveStep}
                      onMoveUp={handleMoveUp}
                    />
                  ))}
                </div>
              )}
              <p className={styles.stepHint}>
                You can reorder or remove steps. The agent spec version and all other
                settings stay the same. Adding new step types is not supported here.
              </p>
            </div>

            {/* Error / success */}
            {error && (
              <div className={styles.err} role="alert">
                {error}
              </div>
            )}
            {success && (
              <div className={styles.successNote} role="status">
                Saved — new version created.
              </div>
            )}

            {/* Footer */}
            <div className={styles.panelFoot}>
              <button
                type="button"
                className={styles.cancel}
                onClick={handleClose}
                disabled={isBusy}
              >
                Cancel
              </button>
              <button
                type="button"
                className={styles.save}
                onClick={handleConfirm}
                disabled={!canConfirm}
              >
                {isPending ? 'Saving…' : 'Save new version'}
              </button>
            </div>
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
