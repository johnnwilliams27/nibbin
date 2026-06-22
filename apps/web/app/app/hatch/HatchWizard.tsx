'use client';

/**
 * Hatch Your Own — the 3-step builder wizard (Group C of the Maya demo, made
 * real). Pure client interaction (step state, chore/app selections, the name
 * input); the actual creation is the `hatchNibbin` server action, which adopts
 * a template under the chosen name and enforces the §6.4 tier cap in SQL.
 *
 * Visual language mirrors the marketing demo wizard (step indicator, chore
 * cards, app toggles, egg/name step) via hatch.module.css — token-only.
 */
import { useEffect, useMemo, useState } from 'react';
import {
  buildCreature,
  USER_SPECIES,
  ACCS,
  MARKS,
  PALETTES,
  type Accessory,
  type Marking,
  type SpeciesName,
} from '@nibbin/creatures';
import { hatchNibbin, type HatchResult } from './actions';
import { InfoTooltip } from '../../../components/ui/Tooltip';
import styles from './hatch.module.css';

interface ChoreOption {
  label: string;
  small: string;
}

const ACC_LABEL: Record<string, string> = {
  none: 'None', glasses: 'Glasses', bow: 'Bow', pencil: 'Pencil',
  broom: 'Broom', quill: 'Quill', coin: 'Coin',
};
const MARK_LABEL: Record<string, string> = {
  none: 'None', spots: 'Spots', stripe: 'Stripe', star: 'Star',
};

/** Mount-gated egg sprite — the engine mints unique gradient ids per render, so
 *  rendering during SSR would mismatch on hydration (same guard as the shell's
 *  KeeperGlyph). The egg only appears on step 3, after mount, so this is free.
 *  Reflects the chosen color/species when the user customizes; else the playful default. */
function EggCreature({ species, color }: { species: SpeciesName; color: string }) {
  const svg = useMemo(
    () => buildCreature({ species, stage: 'egg', color, size: 84 }),
    [species, color],
  );
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return <span className={styles.egg} aria-hidden="true" />;
  return (
    <span className={styles.egg} aria-hidden="true" dangerouslySetInnerHTML={{ __html: svg }} />
  );
}

export function HatchWizard({ chores, apps }: { chores: ChoreOption[]; apps: string[] }) {
  const [step, setStep] = useState(1);
  const [chore, setChore] = useState<number | null>(null);
  /**
   * The primary input: free text from the user. Starter card clicks fill this
   * text (they no longer advance the step automatically — clicking a card is a
   * quick-fill, not a selection gate). `choreText` is what gets passed to the
   * server action; the `chore` index is kept for the fallback path only.
   */
  const [choreText, setChoreText] = useState('');
  const [selApps, setSelApps] = useState<Set<string>>(new Set());
  const [name, setName] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [synthesizing, setSynthesizing] = useState(false);
  const [result, setResult] = useState<HatchResult | null>(null);

  // Optional hatch-time appearance. Defaults match the playful egg; only sent
  // when the user opts in to customize — otherwise the template's look stands.
  const [customizing, setCustomizing] = useState(false);
  const [species, setSpecies] = useState<SpeciesName>('Wisp');
  const [palette, setPalette] = useState<string>('#7B5BD6');
  const [accessory, setAccessory] = useState<Accessory>('none');
  const [marking, setMarking] = useState<Marking>('none');

  const enrolled = result?.ok === true;

  /** Step 1 is valid when the user has typed something OR selected a starter card. */
  const step1Valid = choreText.trim().length > 0 || chore !== null;

  async function onEnroll() {
    const hasFreeText = choreText.trim().length > 0;
    if ((!hasFreeText && chore === null) || name.trim().length === 0 || submitting || enrolled) return;
    setSubmitting(true);
    setSynthesizing(hasFreeText);
    setResult(null);
    try {
      const res = await hatchNibbin({
        chore: chore ?? 0,
        apps: [...selApps],
        name,
        appearance: customizing ? { species, palette, accessory, marking } : undefined,
        choreText: hasFreeText ? choreText.trim() : undefined,
      });
      setResult(res);
    } catch {
      setResult({ ok: false, error: 'Something went wrong hatching your egg. Try again.' });
    } finally {
      setSubmitting(false);
      setSynthesizing(false);
    }
  }

  return (
    <div className={styles.wiz}>
      <div className={styles.steps}>
        {[1, 2, 3].map((i) => (
          <div key={i} className={`${styles.stepInd} ${i <= step ? styles.stepIndOn : ''}`} />
        ))}
      </div>

      {step === 1 && (
        <div className={styles.pane}>
          <h2>What&rsquo;s the chore?{' '}
            <InfoTooltip content="Your Nibbin will watch how you handle this task and draft work for your approval — the more specific you are, the faster it learns." />
          </h2>
          <p className={styles.sub}>
            Describe the thing you&rsquo;re tired of doing — plain words are fine. Or pick a starter
            below to fill it in.
          </p>

          {/* Primary freeform input */}
          <textarea
            className={styles.choreText}
            placeholder="e.g. Remind clients who haven't paid their invoice after 3 days…"
            maxLength={400}
            rows={3}
            value={choreText}
            onChange={(e) => {
              setChoreText(e.target.value);
              // Clear the starter-card selection when the user types their own text.
              if (e.target.value.length > 0) setChore(null);
            }}
            aria-label="Describe the chore you want handled"
          />

          {/* Starter cards — clicking fills the textarea as a quick-fill */}
          <p className={styles.starterLabel}>Or start with one of these:</p>
          <div className={styles.choreGrid}>
            {chores.map((c, i) => (
              <button
                key={c.label}
                type="button"
                className={`${styles.chore} ${chore === i && choreText.trim().length === 0 ? styles.choreSel : ''}`}
                aria-pressed={chore === i && choreText.trim().length === 0}
                onClick={() => {
                  setChore(i);
                  setChoreText('');
                }}
              >
                {c.label}
                <small>{c.small}</small>
              </button>
            ))}
          </div>
          <div className={styles.nav}>
            <span />
            <button
              type="button"
              className={`${styles.btn} ${styles.btnSolid}`}
              disabled={!step1Valid}
              onClick={() => setStep(2)}
            >
              Next →
            </button>
          </div>
        </div>
      )}

      {step === 2 && (
        <div className={styles.pane}>
          <h2>Where does it happen?</h2>
          <p className={styles.sub}>
            Tap the apps involved. Your Nibbin only ever gets the narrowest access that works —
            you set its action level (Observe, Draft, or Act) after it hatches.
          </p>
          <div className={styles.appsel}>
            {apps.map((a) => (
              <button
                key={a}
                type="button"
                className={`${styles.apptag} ${selApps.has(a) ? styles.apptagSel : ''}`}
                aria-pressed={selApps.has(a)}
                onClick={() =>
                  setSelApps((s) => {
                    const n = new Set(s);
                    if (n.has(a)) n.delete(a);
                    else n.add(a);
                    return n;
                  })
                }
              >
                {a}
              </button>
            ))}
          </div>
          <div className={styles.nav}>
            <button
              type="button"
              className={`${styles.btn} ${styles.btnGhost}`}
              onClick={() => setStep(1)}
            >
              ← Back
            </button>
            <button
              type="button"
              className={`${styles.btn} ${styles.btnSolid}`}
              disabled={selApps.size === 0}
              onClick={() => setStep(3)}
            >
              Next →
            </button>
          </div>
        </div>
      )}

      {step === 3 && (
        <div className={styles.pane}>
          <div className={styles.hatch}>
            <h2>Your egg is ready.</h2>
            <div className={styles.sub} style={{ marginLeft: 'auto', marginRight: 'auto' }}>
              It already knows the chore and the apps. Give it a name — that&rsquo;s the whole setup.{' '}
              <InfoTooltip content="Enrolling starts Agent School: your Nibbin watches silently for a few days, then hatches and begins drafting work for your yes-or-no." />
            </div>
            <EggCreature species={species} color={palette} />

            {!enrolled && (
              <button
                type="button"
                className={styles.customToggle}
                aria-expanded={customizing}
                onClick={() => setCustomizing((v) => !v)}
              >
                {customizing ? '▾ Hide look' : '✨ Customize its look (optional)'}
              </button>
            )}

            {customizing && !enrolled && (
              <div className={styles.customBox}>
                <div className={styles.customRow}>
                  <div>
                    <span
                      className={styles.grownPrev}
                      aria-hidden="true"
                      dangerouslySetInnerHTML={{
                        __html: buildCreature({
                          species,
                          stage: 'senior',
                          color: palette,
                          acc: accessory,
                          mark: marking,
                          size: 72,
                        }),
                      }}
                    />
                    <div className={styles.grownCap}>Shown grown — hatches as an egg first.</div>
                  </div>
                  <div style={{ flex: 1 }}>
                    <div className={styles.fld}>
                      <span className={styles.fldLabel}>Color</span>
                      <div className={styles.sw}>
                        {PALETTES.map((p) => (
                          <button
                            key={p.c}
                            type="button"
                            title={p.n}
                            aria-label={p.n}
                            className={`${styles.swatchH} ${palette === p.c ? styles.swatchHOn : ''}`}
                            style={{ background: p.c }}
                            onClick={() => setPalette(p.c)}
                          />
                        ))}
                      </div>
                    </div>
                    <div className={styles.fld}>
                      <span className={styles.fldLabel}>Species</span>
                      <div className={styles.chips}>
                        {USER_SPECIES.map((s) => (
                          <button
                            key={s}
                            type="button"
                            className={`${styles.chip} ${species === s ? styles.chipOn : ''}`}
                            onClick={() => setSpecies(s)}
                          >
                            {s}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
                <div className={styles.fld}>
                  <span className={styles.fldLabel}>Accessory</span>
                  <div className={styles.chips}>
                    {ACCS.map((a) => (
                      <button
                        key={a}
                        type="button"
                        className={`${styles.chip} ${accessory === a ? styles.chipOn : ''}`}
                        onClick={() => setAccessory(a)}
                      >
                        {ACC_LABEL[a] ?? a}
                      </button>
                    ))}
                  </div>
                </div>
                <div className={styles.fld}>
                  <span className={styles.fldLabel}>Marking</span>
                  <div className={styles.chips}>
                    {MARKS.map((m) => (
                      <button
                        key={m}
                        type="button"
                        className={`${styles.chip} ${marking === m ? styles.chipOn : ''}`}
                        onClick={() => setMarking(m)}
                      >
                        {MARK_LABEL[m] ?? m}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}

            <div className={styles.nameline}>
              <input
                type="text"
                placeholder="Name your Nibbin…"
                maxLength={14}
                value={name}
                disabled={enrolled || submitting}
                onChange={(e) => setName(e.target.value)}
                aria-label="Name your Nibbin"
              />
              <button
                type="button"
                className={`${styles.btn} ${styles.btnSolid}`}
                disabled={name.trim().length === 0 || enrolled || submitting}
                onClick={onEnroll}
              >
                {enrolled
                  ? '✓ Enrolled'
                  : synthesizing
                    ? 'Building your Nibbin…'
                    : submitting
                      ? 'Enrolling…'
                      : 'Enroll in Agent School'}
              </button>
            </div>
            {/* Surface the failure right under the action that triggered it
                (the Enroll button) so the "connect Gmail first" message is in
                view — it used to render below the long note, off-screen. */}
            {result && !result.ok && (
              <div className={styles.error} role="alert">
                {result.error}
                {result.capped && (
                  <>
                    {' '}
                    <a href="/billing">Move up a plan</a>.
                  </>
                )}
              </div>
            )}
            <p className={styles.note}>
              It starts as an egg: watching only. In a few days it hatches into a student and begins
              drafting work for your approval. You decide what it may do — Observe, Draft, or Act —
              and Agent School grades how accurately it handles the chore.
            </p>

            {synthesizing && !enrolled && (
              <div className={styles.thinking} role="status" aria-live="polite">
                Crafting a custom Nibbin from your description…
              </div>
            )}

            {enrolled && (
              <div className={styles.enrolled} role="status">
                🎒 <b>{result?.name ?? name.trim()}</b> is enrolled in Agent School. It&rsquo;s
                watching how you handle this chore now — expect its first drafts in your Today feed
                within a few days.
              </div>
            )}
            {enrolled && result?.fallbackNote && (
              <p className={styles.fallbackNote}>{result.fallbackNote}</p>
            )}
          </div>
          <div className={styles.nav}>
            <button
              type="button"
              className={`${styles.btn} ${styles.btnGhost}`}
              onClick={() => setStep(2)}
              disabled={submitting}
            >
              ← Back
            </button>
            <span />
          </div>
        </div>
      )}
    </div>
  );
}
