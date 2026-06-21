'use client';

/**
 * "Make this recurring" preview (Crystallization Slice 4, design §6). Shows the
 * recurring steps in plain language, a cadence picker (the user's EXPLICIT
 * choice — defaulted to the suggested cadence if present, else unselected), the
 * connectors needed, and a name field. Confirm → adoptCrystal → the Beat-2 hatch
 * ceremony (an egg — drafts for approval; you set its action level when ready). Tokens-only,
 * brand voice, no coral.
 */
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button, Card, Select } from '../../../components/ui';
import { AdoptHatch } from '../../../components/adopt/AdoptHatch';
import type { AdoptOutcome } from '../../../components/adopt/types';
import { adoptCrystal } from './actions';
import type { CrystalPreview as Preview } from '../../../lib/planner/crystallize';
import type { TriggerDef } from '@nibbin/runtime';
import styles from './planner.module.css';

type Hatch = Extract<AdoptOutcome, { ok: true }>;

/** The standard cadences offered (mirrors STANDARD_CADENCES). */
const CADENCE_OPTIONS = [
  { value: 'daily.morning', label: 'Every morning' },
  { value: 'daily.evening', label: 'Every evening' },
  { value: 'weekly.monday', label: 'Every Monday' },
  { value: 'weekly.friday', label: 'Every Friday' },
];

function connectorLabel(provider: string): string {
  switch (provider) {
    case 'gmail':
      return 'Gmail';
    case 'google-calendar':
      return 'Google Calendar';
    case 'stripe':
      return 'Stripe';
    default:
      return provider;
  }
}

export function CrystalPreview({
  planRunId,
  preview,
  defaultName,
}: {
  planRunId: string;
  preview: Preview;
  defaultName: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [name, setName] = useState(defaultName);
  const suggested =
    preview.suggestedTrigger?.kind === 'schedule' ? preview.suggestedTrigger.schedule ?? '' : '';
  const [error, setError] = useState<string | null>(null);
  const [hatch, setHatch] = useState<Hatch | null>(null);

  function confirm(formData: FormData) {
    const chosen = String(formData.get('cadence') ?? '').trim();
    if (!chosen) {
      setError('Pick how often it should run.');
      return;
    }
    setError(null);
    const trigger: TriggerDef = { kind: 'schedule', schedule: chosen };
    startTransition(async () => {
      const outcome = await adoptCrystal(planRunId, name.trim() || defaultName, trigger);
      if ('refused' in outcome) {
        setError("This run can't be made recurring right now.");
        return;
      }
      if (!outcome.ok) {
        router.push(outcome.redirectTo);
        return;
      }
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

  return (
    <Card className={styles.previewCard}>
      <p className={styles.eyebrow}>Make this recurring</p>
      <p className={styles.sub}>
        Turn this into a Nibbin that does the same thing on a schedule you choose.
      </p>

      <p className={styles.surfaceLabel}>What it will do</p>
      <ul className={styles.stepList}>
        {preview.steps.map((s, i) => (
          <li key={i}>{s}</li>
        ))}
      </ul>

      {preview.connectorsNeeded.length > 0 ? (
        <>
          <p className={styles.surfaceLabel}>Connections it needs</p>
          <p className={styles.sub}>{preview.connectorsNeeded.map(connectorLabel).join(', ')}</p>
        </>
      ) : null}

      <form action={confirm}>
        <label className={styles.surfaceLabel} htmlFor="crystal-cadence">
          How often
        </label>
        <Select
          name="cadence"
          id="crystal-cadence"
          options={CADENCE_OPTIONS}
          defaultValue={suggested}
          placeholder="Choose a cadence"
          aria-label="How often it should run"
        />

        <label className={styles.surfaceLabel} htmlFor="crystal-name">
          Name
        </label>
        <input
          id="crystal-name"
          className={styles.respondInput}
          value={name}
          maxLength={40}
          onChange={(e) => setName(e.target.value)}
          placeholder="Give it a name"
        />

        <p className={styles.assurance}>
          It hatches as an egg — it drafts everything for your approval. You set its action level (Observe / Draft / Send) whenever you&rsquo;re ready. You
          can also run it any time.
        </p>

        {error ? <p className={styles.error}>{error}</p> : null}

        <div className={styles.actions}>
          <Button type="submit" disabled={pending}>
            {pending ? 'Hatching…' : 'Make it recurring'}
          </Button>
        </div>
      </form>
    </Card>
  );
}
