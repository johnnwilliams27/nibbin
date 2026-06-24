'use client';

/**
 * Agent Builder — the unified entry that merges the old "Hatch your own" and
 * "Planner" nav items into one surface (the jargon collision between "hatch a
 * Nibbin" and "ask a Nibbin" was the whole problem).
 *
 * The user describes the task ONCE, then picks the mode:
 *   • Run it once now      → routes into the existing Planner flow (PlanComposer
 *                            / startPlanRun) at /app/planner, intent pre-filled.
 *   • Build a Nibbin       → routes into the existing Hatch flow (HatchWizard /
 *                            hatchNibbin) at /app/hatch, chore text pre-filled.
 *
 * Neither engine is rebuilt here — this page only unifies the entry + the mode
 * choice and carries the described intent across via the `?intent=` query param.
 */
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button } from '../../../components/ui';
import styles from './build.module.css';

export type BuildMode = 'once' | 'save';

/**
 * Pure mode→route mapping for the Agent Builder chooser. Exported so the routing
 * contract is unit-testable without a router context:
 *   • 'once' → the existing Planner one-off flow (/app/planner)
 *   • 'save' → the existing Hatch persistent-Nibbin flow (/app/hatch)
 * A non-empty intent is carried across as a URL-encoded `?intent=` query param.
 */
export function buildModeHref(mode: BuildMode, intent: string): string {
  const trimmed = intent.trim();
  const q = trimmed.length > 0 ? `?intent=${encodeURIComponent(trimmed)}` : '';
  const base = mode === 'once' ? '/app/planner' : '/app/hatch';
  return `${base}${q}`;
}

export function BuildChooser() {
  const router = useRouter();
  const [intent, setIntent] = useState('');
  const [routing, setRouting] = useState<BuildMode | null>(null);

  function go(mode: BuildMode) {
    setRouting(mode);
    router.push(buildModeHref(mode, intent));
  }

  return (
    <div>
      <label className={styles.fieldLabel} htmlFor="build-intent">
        What do you want done?
      </label>
      <textarea
        id="build-intent"
        className={styles.intentInput}
        value={intent}
        onChange={(e) => setIntent(e.target.value)}
        placeholder="Describe it in plain words — e.g. “remind clients who haven't paid after 3 days” or “tell me what needs my attention today”"
        rows={3}
        maxLength={400}
      />

      <p className={styles.chooseLabel}>Then choose how it runs:</p>
      <div className={styles.modeGrid}>
        <div className={styles.modeCard}>
          <span className={styles.modeEyebrow}>One-off</span>
          <h2 className={styles.modeTitle}>Run a one-off task</h2>
          <p className={styles.modeBody}>
            A Nibbin lays out a small plan, you approve it, and it does the job
            once — right now. Nothing is saved or sends without your okay.
          </p>
          <Button onClick={() => go('once')} disabled={routing !== null}>
            {routing === 'once' ? 'Opening…' : 'Run it once →'}
          </Button>
        </div>

        <div className={styles.modeCard}>
          <span className={styles.modeEyebrow}>Recurring</span>
          <h2 className={styles.modeTitle}>Build a Nibbin that does this regularly</h2>
          <p className={styles.modeBody}>
            Hatch a custom-named Nibbin that learns this chore and keeps handling
            it — drafting work for your approval every time it comes up.
          </p>
          <Button variant="secondary" onClick={() => go('save')} disabled={routing !== null}>
            {routing === 'save' ? 'Opening…' : 'Build a Nibbin →'}
          </Button>
        </div>
      </div>

      <p className={styles.hint}>
        Not sure? Start with a one-off run. You can always build a Nibbin for it
        later if it&rsquo;s something you do again and again.
      </p>
    </div>
  );
}
