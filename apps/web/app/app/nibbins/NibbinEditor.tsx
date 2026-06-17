'use client';

/**
 * Nibbin configurator — rename + restyle one of your own nibbins.
 * Opens a modal with a live buildCreature() preview driven by the picker state
 * (the engine is pure JS, so it runs client-side). Stage is shown read-only:
 * it's earned in Agent School, not chosen. Save calls the updateNibbinAppearance
 * server action, which routes through the security-definer RPC. The canonical
 * Grovekeeper is never rendered here, so every nibbin shown is editable.
 */
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  buildCreature,
  USER_SPECIES,
  ACCS,
  MARKS,
  PALETTES,
  type Accessory,
  type Marking,
  type SpeciesName,
  type Stage,
} from '@nibbin/creatures';
import { updateNibbinAppearance } from './actions';
import styles from './nibbins.module.css';

export interface EditableNibbin {
  id: string;
  name: string;
  species: string;
  stage: Stage;
  palette: string | null;
  accessory: string | null;
  marking: string | null;
}

const ACC_LABEL: Record<string, string> = {
  none: 'None', glasses: 'Glasses', bow: 'Bow', pencil: 'Pencil',
  broom: 'Broom', quill: 'Quill', coin: 'Coin',
};
const MARK_LABEL: Record<string, string> = {
  none: 'None', spots: 'Spots', stripe: 'Stripe', star: 'Star',
};
const STAGE_LABEL: Record<Stage, string> = {
  egg: 'Egg', student: 'Student', senior: 'Senior', grad: 'Graduate',
};

export function NibbinEditor({ nibbin }: { nibbin: EditableNibbin }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(nibbin.name);
  const [species, setSpecies] = useState<SpeciesName>(nibbin.species as SpeciesName);
  const [palette, setPalette] = useState(nibbin.palette ?? PALETTES[0].c);
  const [accessory, setAccessory] = useState<Accessory>((nibbin.accessory ?? 'none') as Accessory);
  const [marking, setMarking] = useState<Marking>((nibbin.marking ?? 'none') as Marking);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function reset() {
    setName(nibbin.name);
    setSpecies(nibbin.species as SpeciesName);
    setPalette(nibbin.palette ?? PALETTES[0].c);
    setAccessory((nibbin.accessory ?? 'none') as Accessory);
    setMarking((nibbin.marking ?? 'none') as Marking);
    setError(null);
  }
  function close() {
    setOpen(false);
    reset();
  }

  async function save() {
    setSaving(true);
    setError(null);
    const res = await updateNibbinAppearance(nibbin.id, {
      name: name.trim(),
      species,
      palette,
      accessory,
      marking,
    });
    setSaving(false);
    if (!res.ok) {
      setError(res.error ?? 'Could not save changes.');
      return;
    }
    setOpen(false);
    router.refresh();
  }

  const preview = buildCreature({
    species,
    stage: nibbin.stage,
    color: palette,
    acc: accessory,
    mark: marking,
    size: 88,
  });

  return (
    <>
      <button type="button" className={styles.editBtn} onClick={() => setOpen(true)}>
        Edit
      </button>

      {open && (
        <div
          className={styles.overlay}
          role="dialog"
          aria-modal="true"
          aria-label={`Edit ${nibbin.name}`}
          onClick={(e) => {
            if (e.target === e.currentTarget) close();
          }}
        >
          <div className={styles.panel}>
            <div className={styles.panelHead}>
              <span
                className={styles.preview}
                aria-hidden="true"
                dangerouslySetInnerHTML={{ __html: preview }}
              />
              <div>
                <h3 className={styles.panelTitle}>Customize your Nibbin</h3>
                <div className={styles.panelSub}>
                  Stage: {STAGE_LABEL[nibbin.stage]} · earned, not chosen
                </div>
              </div>
            </div>

            <div className={styles.field}>
              <label className={styles.label} htmlFor={`nm-${nibbin.id}`}>Name</label>
              <input
                id={`nm-${nibbin.id}`}
                className={styles.nameInput}
                value={name}
                maxLength={40}
                onChange={(e) => setName(e.target.value)}
              />
            </div>

            <div className={styles.field}>
              <span className={styles.label}>Species</span>
              <div className={styles.opts}>
                {USER_SPECIES.map((s) => (
                  <button
                    key={s}
                    type="button"
                    className={`${styles.opt} ${species === s ? styles.optActive : ''}`}
                    onClick={() => setSpecies(s)}
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>

            <div className={styles.field}>
              <span className={styles.label}>Color</span>
              <div className={styles.swatches}>
                {PALETTES.map((p) => (
                  <button
                    key={p.c}
                    type="button"
                    title={p.n}
                    aria-label={p.n}
                    className={`${styles.swatch} ${palette === p.c ? styles.swatchActive : ''}`}
                    style={{ background: p.c }}
                    onClick={() => setPalette(p.c)}
                  />
                ))}
              </div>
            </div>

            <div className={styles.field}>
              <span className={styles.label}>Accessory</span>
              <div className={styles.opts}>
                {ACCS.map((a) => (
                  <button
                    key={a}
                    type="button"
                    className={`${styles.opt} ${accessory === a ? styles.optActive : ''}`}
                    onClick={() => setAccessory(a)}
                  >
                    {ACC_LABEL[a] ?? a}
                  </button>
                ))}
              </div>
            </div>

            <div className={styles.field}>
              <span className={styles.label}>Marking</span>
              <div className={styles.opts}>
                {MARKS.map((m) => (
                  <button
                    key={m}
                    type="button"
                    className={`${styles.opt} ${marking === m ? styles.optActive : ''}`}
                    onClick={() => setMarking(m)}
                  >
                    {MARK_LABEL[m] ?? m}
                  </button>
                ))}
              </div>
            </div>

            {error && <div className={styles.err}>{error}</div>}

            <div className={styles.panelFoot}>
              <button type="button" className={styles.cancel} onClick={close} disabled={saving}>
                Cancel
              </button>
              <button
                type="button"
                className={styles.save}
                onClick={save}
                disabled={saving || name.trim() === ''}
              >
                {saving ? 'Saving…' : 'Save changes'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
