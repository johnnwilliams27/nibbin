'use client';

/**
 * Review-before-adopt for a SYNTHESIZED Nibbin (Composer Slice 2a, design §2.6).
 *
 * "Build a Nibbin for this" → composes a proposal (synthesizeForWorkflow, no
 * adopt) → shows the human-readable plan, persona, trigger, connectors needed,
 * and a name field → confirm → adoptSynthesized → the Beat-2 hatch ceremony. A
 * synthesized agent always goes through an explicit human confirm before it
 * exists; it hatches as an Egg and is School-gated like any Nibbin.
 */
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '../../../components/ui';
import { AdoptHatch } from '../../../components/adopt/AdoptHatch';
import type { AdoptOutcome } from '../../../components/adopt/types';
import { synthesizeForWorkflow, adoptSynthesized, type ComposerReviewResult } from './actions';
import styles from './diagnosis.module.css';

type Hatch = Extract<AdoptOutcome, { ok: true }>;
type Review = Extract<ComposerReviewResult, { ok: true }>;

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
      setName(result.displayName);
    });
  }

  function confirm() {
    if (!review) return;
    setError(null);
    const reviewed = review;
    startTransition(async () => {
      // Adopt the EXACT spec the user reviewed — no recomposition (FIX 3:
      // a 2nd model call could drift from what they approved). adoptSynthesized
      // re-validates it fail-closed server-side before any write.
      const outcome = await adoptSynthesized(reviewed.spec, name.trim() || undefined);
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

  if (review) {
    return (
      <div className={styles.buildReview}>
        <p className={styles.buildPlan}>{review.summary}</p>
        <dl className={styles.buildMeta}>
          <div>
            <dt>Persona</dt>
            <dd>{review.tone}</dd>
          </div>
          <div>
            <dt>When it runs</dt>
            <dd>{review.trigger}</dd>
          </div>
          <div>
            <dt>Connections it needs</dt>
            <dd>{review.connectorsNeeded.join(', ')}</dd>
          </div>
        </dl>
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
          <Button type="button" variant="primary" onClick={confirm} disabled={pending}>
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
