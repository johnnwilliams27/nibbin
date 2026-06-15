import type { Metadata } from 'next';
import { appSession } from '../../../lib/auth/app-session';
import { MEMORY_SECTIONS } from '../../../lib/grove/memory';
import { AppShell } from '../../../components/shell/AppShell';
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

/** One "Label: value" line from a string or string[]; null if there's nothing. */
function answerLine(label: string, v: unknown): string | null {
  if (typeof v === 'string' && v.trim() !== '') return `${label}: ${v.trim()}`;
  if (Array.isArray(v)) {
    const xs = v.filter((x): x is string => typeof x === 'string' && x.trim() !== '');
    if (xs.length) return `${label}: ${xs.join(', ')}`;
  }
  return null;
}

/**
 * Seed the "facts" section from the onboarding answers blob. Post-#73 that blob
 * also carries the model's `_understanding`/`_profile` OBJECTS, so we must never
 * blindly stringify it (that yields "[object Object]"). Prefer the model's
 * profile; fall back to the legacy interview scalars. Returns {} when empty.
 */
function seedSectionsFromAnswers(answers: Record<string, unknown>): Record<string, string> {
  const lines: string[] = [];
  const profile = answers._profile;
  if (profile && typeof profile === 'object' && !Array.isArray(profile)) {
    const p = profile as Record<string, unknown>;
    for (const [label, key] of [
      ['What I do', 'jobTitle'],
      ['Business model', 'businessModel'],
      ['Main work', 'workShape'],
      ['Channels', 'channels'],
      ['Tools', 'tools'],
      ['Frustrations', 'pains'],
    ] as const) {
      if (key === 'businessModel' && p[key] === 'unknown') continue;
      const line = answerLine(label, p[key]);
      if (line) lines.push(line);
    }
  }
  if (lines.length === 0) {
    // legacy interview scalars only — never the `_`-prefixed state objects
    for (const [label, key] of [
      ['What I do', 'craft'],
      ['Time sinks', 'timeSinks'],
      ['Channels', 'channels'],
    ] as const) {
      const line = answerLine(label, answers[key]);
      if (line) lines.push(line);
    }
  }
  return lines.length ? { facts: lines.join('\n') } : {};
}

export default async function MemoryPage({
  searchParams,
}: {
  searchParams: Promise<{ saved?: string; error?: string }>;
}) {
  const { saved, error } = await searchParams;
  const { supabase, accountId, user } = await appSession();

  const { data: mem } = await supabase
    .from('grove_memory')
    .select('sections, hard_rules, notes')
    .eq('account_id', accountId)
    .maybeSingle<MemoryRow>();

  // Min population: an empty brain seeds "facts" from onboarding so the first
  // visit isn't a blank page (the user then curates from there).
  let sections = mem?.sections ?? {};
  if (!mem) {
    const { data: st } = await supabase
      .from('grove_state')
      .select('answers')
      .eq('account_id', accountId)
      .maybeSingle<StateRow>();
    if (st?.answers) sections = seedSectionsFromAnswers(st.answers);
  }
  const rules = (mem?.hard_rules ?? []).join('\n');
  const notes = mem?.notes ?? '';

  return (
    <AppShell active="memory" title="Grove Memory" email={user.email}>
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
    </AppShell>
  );
}
