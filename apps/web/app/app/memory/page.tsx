import type { Metadata } from 'next';
import { appSession } from '../../../lib/auth/app-session';
import { AppShell } from '../../../components/shell/AppShell';
import { MemoryClient } from './MemoryClient';
import styles from './memory.module.css';

export const metadata: Metadata = { title: 'What your grove knows — Nibbin' };
export const dynamic = 'force-dynamic';

interface MemoryRow {
  sections: Record<string, string> | null;
  hard_rules: string[] | null;
  notes: string | null;
  reference_text: string | null;
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

/** Build a lookup of field key → value for rendering. */
function buildFieldValues(
  sections: Record<string, string>,
  rules: string,
  notes: string,
): Record<string, string> {
  const out: Record<string, string> = { ...sections };
  out['hard_rules'] = rules;
  out['notes'] = notes;
  return out;
}

/** True when every field in the lookup is blank. */
function allEmpty(values: Record<string, string>): boolean {
  return Object.values(values).every((v) => v.trim() === '');
}

export default async function MemoryPage() {
  const { supabase, accountId, user } = await appSession();

  const { data: mem } = await supabase
    .from('grove_memory')
    .select('sections, hard_rules, notes, reference_text')
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
  const referenceText = mem?.reference_text ?? '';

  const fieldValues = buildFieldValues(sections, rules, notes);
  const isEmpty = allEmpty(fieldValues);

  return (
    <AppShell active="memory" title="Grove Memory" email={user.email}>
      <h1 className={styles.h1}>What your grove knows</h1>
      <p className={styles.lede}>
        Everything here is shared with your Nibbins so their drafts sound like you — not a generic
        assistant. Edit or clear any of it, anytime; it&apos;s yours.
      </p>

      <MemoryClient
        initialValues={fieldValues}
        initialReference={referenceText}
        isEmpty={isEmpty}
      />
    </AppShell>
  );
}
