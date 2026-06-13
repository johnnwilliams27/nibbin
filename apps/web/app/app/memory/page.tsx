import type { Metadata } from 'next';
import { appSession } from '../../../lib/auth/app-session';
import { MEMORY_SECTIONS } from '../../../lib/grove/memory';
import { saveGroveMemory } from './actions';
import styles from './memory.module.css';

export const metadata: Metadata = { title: 'What your grove knows — Nibbin' };
export const dynamic = 'force-dynamic';

const PLACEHOLDERS: Record<string, string> = {
  facts: 'What you do, who you serve, where you’re based…',
  pricing: 'Your rates, packages, deposits…',
  policies: 'Cancellations, rescheduling, turnaround, payment terms…',
  faq: 'The questions you answer over and over — and your usual answers…',
  voice: 'How you sound — warm, brief, a little playful? Paste a reply you’re proud of…',
};

interface MemoryRow {
  sections: Record<string, string> | null;
  hard_rules: string[] | null;
  notes: string | null;
}
interface StateRow {
  answers: Record<string, unknown> | null;
}

export default async function MemoryPage({
  searchParams,
}: {
  searchParams: Promise<{ saved?: string; error?: string }>;
}) {
  const { saved, error } = await searchParams;
  const { supabase, accountId } = await appSession();

  const { data: mem } = await supabase
    .from('grove_memory')
    .select('sections, hard_rules, notes')
    .eq('account_id', accountId)
    .maybeSingle<MemoryRow>();

  // Min population: an empty brain seeds "facts" from the Keeper-interview answers
  // so the first visit isn't a blank page (the user then curates from there).
  let sections = mem?.sections ?? {};
  if (!mem) {
    const { data: st } = await supabase
      .from('grove_state')
      .select('answers')
      .eq('account_id', accountId)
      .maybeSingle<StateRow>();
    const seed = Object.values(st?.answers ?? {})
      .map((v) => String(v ?? '').trim())
      .filter(Boolean)
      .join('\n');
    if (seed) sections = { facts: seed };
  }
  const rules = (mem?.hard_rules ?? []).join('\n');
  const notes = mem?.notes ?? '';

  return (
    <main className={styles.page}>
      <p className={styles.eyebrow}>Grove Memory</p>
      <h1 className={styles.h1}>What your grove knows</h1>
      <p className={styles.lede}>
        Everything here is shared with your Nibbins so their drafts sound like you — not a generic
        assistant. Edit or clear any of it, anytime; it’s yours.
      </p>
      {saved && <p className={styles.saved}>Saved — your grove will use this from its next draft.</p>}
      {error && <p className={styles.error}>That didn’t save. Give it another try.</p>}

      <form action={saveGroveMemory} className={styles.form}>
        {MEMORY_SECTIONS.map(({ key, label }) => (
          <div className={styles.field} key={key}>
            <label className={styles.label} htmlFor={key}>
              {label}
            </label>
            <textarea
              className={styles.textarea}
              id={key}
              name={key}
              rows={key === 'facts' ? 4 : 3}
              defaultValue={sections[key] ?? ''}
              placeholder={PLACEHOLDERS[key]}
            />
          </div>
        ))}

        <div className={styles.field}>
          <label className={styles.label} htmlFor="hard_rules">
            Hard rules
          </label>
          <p className={styles.hint}>
            One per line. Your Nibbins treat these as non-negotiable — never broken in a draft.
          </p>
          <textarea
            className={styles.textarea}
            id="hard_rules"
            name="hard_rules"
            rows={4}
            defaultValue={rules}
            placeholder={'Never promise a delivery date without checking with me\nAlways address clients by first name'}
          />
        </div>

        <div className={styles.field}>
          <label className={styles.label} htmlFor="notes">
            Anything else
          </label>
          <textarea
            className={styles.textarea}
            id="notes"
            name="notes"
            rows={3}
            defaultValue={notes}
            placeholder="Free notes — anything that helps your grove understand the work."
          />
        </div>

        <button className={styles.primary} type="submit">
          Save
        </button>
      </form>
    </main>
  );
}
