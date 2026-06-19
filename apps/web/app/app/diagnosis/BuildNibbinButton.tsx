'use client';

/**
 * Review-before-adopt for a SYNTHESIZED Nibbin (Composer Slice 2a, design §2.6;
 * Part B editing).
 *
 * "Build a Nibbin for this" → composes a proposal (synthesizeForWorkflow, no
 * adopt) → shows the human-readable plan, persona, trigger, connectors needed,
 * a name field, AND an editable plan: the user may reorder/remove steps, tweak
 * each step's exposed scalar params (staleDays/withinDays/topSenders/…), and
 * change the cadence. Each edit is re-validated SERVER-SIDE (previewComposerEdit)
 * fail-closed, so the confirm button only ever sends a valid edit. On confirm,
 * the edit is applied + re-validated again inside adoptSynthesized before any
 * write → the Beat-2 hatch ceremony.
 *
 * Safety: the user can ONLY reorder/remove steps + tweak schema-bounded scalar
 * params + name/cadence. They never see or touch a read path or effectArgs; the
 * server rebuilds the trusted envelope from the registry and re-validates every
 * field. The validator is the trust boundary, not the client form.
 */
import { useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '../../../components/ui';
import { AdoptHatch } from '../../../components/adopt/AdoptHatch';
import type { AdoptOutcome } from '../../../components/adopt/types';
import {
  synthesizeForWorkflow,
  adoptSynthesized,
  previewComposerEdit,
  type ComposerReviewResult,
} from './actions';
import type { ComposerEdit, EditablePlan, EditableStep } from '../../../lib/composer/compose';
import styles from './diagnosis.module.css';

type Hatch = Extract<AdoptOutcome, { ok: true }>;
type Review = Extract<ComposerReviewResult, { ok: true }>;

/** Friendly cadence labels for the dropdown. */
const CADENCE_LABEL: Record<string, string> = {
  'daily.morning': 'Every morning',
  'daily.evening': 'Every evening',
  'weekly.monday': 'Weekly (Mondays)',
  hourly: 'Every hour',
};

/** Turn the editable plan into the ComposerEdit the server re-validates. */
function toEdit(plan: EditablePlan): ComposerEdit {
  return {
    displayName: plan.displayName,
    cadence: plan.cadence,
    steps: plan.steps.map((s) => ({
      capability: s.capability,
      inputs: Object.fromEntries(s.params.map((p) => [p.key, p.value])),
    })),
  };
}

export function BuildNibbinButton({
  diagnosisId,
  workflowKey,
  label = 'Build a Nibbin for this',
}: {
  diagnosisId: string;
  workflowKey: string;
  label?: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [review, setReview] = useState<Review | null>(null);
  const [plan, setPlanState] = useState<EditablePlan | null>(null);
  // Mirror the latest plan in a ref so a param-commit (onBlur) revalidates the
  // freshest plan, not the stale closure value captured at render.
  const planRef = useRef<EditablePlan | null>(null);
  const setPlan = (p: EditablePlan | null) => {
    planRef.current = p;
    setPlanState(p);
  };
  const [summary, setSummary] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [hatch, setHatch] = useState<Hatch | null>(null);

  function propose() {
    setError(null);
    startTransition(async () => {
      const result = await synthesizeForWorkflow(diagnosisId, workflowKey);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setReview(result);
      setPlan(result.editable);
      setSummary(result.summary);
      setName(result.displayName);
    });
  }

  /** Re-validate the edited plan server-side, refreshing the summary (and the
   *  normalized plan) or surfacing a validation error. */
  function revalidate(next: EditablePlan) {
    if (!review) return;
    setPlan(next);
    setError(null);
    startTransition(async () => {
      const res = await previewComposerEdit(review.spec, toEdit(next), review.workflowLabel);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setSummary(res.summary);
      setPlan(res.editable);
    });
  }

  function moveStep(idx: number, dir: -1 | 1) {
    if (!plan) return;
    const steps = [...plan.steps];
    const j = idx + dir;
    if (j < 0 || j >= steps.length) return;
    [steps[idx], steps[j]] = [steps[j], steps[idx]];
    revalidate({ ...plan, steps });
  }

  function removeStep(idx: number) {
    if (!plan || plan.steps.length <= 1) return;
    revalidate({ ...plan, steps: plan.steps.filter((_, i) => i !== idx) });
  }

  function setParam(stepIdx: number, paramIdx: number, raw: string) {
    if (!plan) return;
    const steps = plan.steps.map((s, i) => {
      if (i !== stepIdx) return s;
      const params = s.params.map((p, k) => {
        if (k !== paramIdx) return p;
        const value = p.type === 'number' ? (raw === '' ? '' : Number(raw)) : raw;
        return { ...p, value: value as number | string };
      });
      return { ...s, params };
    });
    // Local update only while typing; revalidate on blur/commit below.
    setPlan({ ...plan, steps });
  }

  function setCadence(cadence: string) {
    if (!plan) return;
    revalidate({ ...plan, cadence: cadence as EditablePlan['cadence'] });
  }

  function confirm() {
    if (!review || !plan) return;
    setError(null);
    const reviewed = review;
    const edit = toEdit({ ...plan, displayName: name.trim() || plan.displayName });
    startTransition(async () => {
      // Adopt the reviewed spec + the user's edit; adoptSynthesized applies the
      // edit and re-validates it fail-closed SERVER-SIDE before any write.
      const outcome = await adoptSynthesized(reviewed.spec, name.trim() || undefined, edit, reviewed.workflowLabel);
      if (!outcome.ok) {
        router.push(outcome.redirectTo);
        return;
      }
      setReview(null);
      setHatch(outcome);
    });
  }

  if (hatch) {
    return (
      <AdoptHatch
        name={hatch.name}
        species={hatch.species}
        stage={hatch.stage}
        palette={hatch.palette}
        accessory={hatch.accessory}
        marking={hatch.marking}
        isFirstAdoption={hatch.isFirstAdoption}
        onDismiss={() => router.push(hatch.ctaPath)}
      />
    );
  }

  if (review && plan) {
    return (
      <div className={styles.buildReview}>
        <p className={styles.buildPlan}>{summary}</p>

        <div className={styles.editSteps}>
          {plan.steps.map((step, i) => (
            <StepEditor
              key={`${step.capability}-${i}`}
              step={step}
              idx={i}
              total={plan.steps.length}
              disabled={pending}
              onUp={() => moveStep(i, -1)}
              onDown={() => moveStep(i, 1)}
              onRemove={() => removeStep(i)}
              onParam={(pi, raw) => setParam(i, pi, raw)}
              onParamCommit={() => planRef.current && revalidate(planRef.current)}
            />
          ))}
        </div>

        <dl className={styles.buildMeta}>
          <div>
            <dt>Persona</dt>
            <dd>{review.tone}</dd>
          </div>
          <div>
            <dt>Connections it needs</dt>
            <dd>{review.connectorsNeeded.join(', ')}</dd>
          </div>
        </dl>

        <label className={styles.buildNameLabel}>
          When it runs
          <select
            className={styles.buildSelect}
            value={plan.cadence}
            disabled={pending}
            onChange={(e) => setCadence(e.target.value)}
          >
            {review.cadenceOptions.map((c) => (
              <option key={c} value={c}>
                {CADENCE_LABEL[c] ?? c} — and whenever you ask
              </option>
            ))}
          </select>
        </label>

        <label className={styles.buildNameLabel}>
          Name
          <input
            className={styles.buildNameInput}
            value={name}
            maxLength={40}
            onChange={(e) => setName(e.target.value)}
            placeholder="Give it a name"
          />
        </label>
        {error && <p className={styles.buildError}>{error}</p>}
        <div className={styles.buildActions}>
          <Button type="button" variant="primary" onClick={confirm} disabled={pending || !!error}>
            {pending ? 'Hatching…' : 'Confirm and hatch'}
          </Button>
          <Button type="button" variant="ghost" onClick={() => setReview(null)} disabled={pending}>
            Not now
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div>
      <Button type="button" variant="secondary" onClick={propose} disabled={pending}>
        {pending ? 'Thinking…' : label}
      </Button>
      {error && <p className={styles.buildError}>{error}</p>}
    </div>
  );
}

/** One step's editor row: reorder + remove controls + its scalar params. */
function StepEditor({
  step,
  idx,
  total,
  disabled,
  onUp,
  onDown,
  onRemove,
  onParam,
  onParamCommit,
}: {
  step: EditableStep;
  idx: number;
  total: number;
  disabled: boolean;
  onUp: () => void;
  onDown: () => void;
  onRemove: () => void;
  onParam: (paramIdx: number, raw: string) => void;
  onParamCommit: () => void;
}) {
  return (
    <div className={styles.editStep}>
      <div className={styles.editStepHead}>
        <span className={styles.editStepNum}>{idx + 1}</span>
        <span className={styles.editStepLabel}>{step.label}</span>
        <button
          type="button"
          className={styles.editStepBtn}
          onClick={onUp}
          disabled={disabled || idx === 0}
          aria-label="Move step up"
        >
          ↑
        </button>
        <button
          type="button"
          className={styles.editStepBtn}
          onClick={onDown}
          disabled={disabled || idx === total - 1}
          aria-label="Move step down"
        >
          ↓
        </button>
        <button
          type="button"
          className={styles.editStepBtn}
          onClick={onRemove}
          disabled={disabled || total <= 1}
          aria-label="Remove step"
        >
          Remove
        </button>
      </div>
      {step.params.length > 0 && (
        <div className={styles.editParams}>
          {step.params.map((p, pi) =>
            p.type === 'number' ? (
              <div key={p.key} className={styles.editParam}>
                <span className={styles.editParamLabel}>{p.key}</span>
                <input
                  className={styles.editParamInput}
                  type="number"
                  inputMode="numeric"
                  value={String(p.value)}
                  min={p.min}
                  max={p.max}
                  disabled={disabled}
                  onChange={(e) => onParam(pi, e.target.value)}
                  onBlur={onParamCommit}
                />
                {(p.min !== undefined || p.max !== undefined) && (
                  <span className={styles.editParamBounds}>
                    {p.min ?? '–'}…{p.max ?? '–'}
                  </span>
                )}
              </div>
            ) : (
              <div key={p.key} className={styles.editParam}>
                <span className={styles.editParamLabel}>{p.key}</span>
                <select
                  className={styles.buildSelect}
                  value={String(p.value)}
                  disabled={disabled}
                  onChange={(e) => {
                    onParam(pi, e.target.value);
                    onParamCommit();
                  }}
                >
                  {(p.values ?? []).map((v) => (
                    <option key={v} value={v}>
                      {v}
                    </option>
                  ))}
                </select>
              </div>
            ),
          )}
        </div>
      )}
    </div>
  );
}
