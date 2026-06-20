import type { Metadata } from 'next';
import { appSession } from '../../../lib/auth/app-session';
import { AppShell } from '../../../components/shell/AppShell';
import { saveGroveMemory } from './actions';
import styles from './memory.module.css';

export const metadata: Metadata = { title: 'What your grove knows — Nibbin' };
export const dynamic = 'force-dynamic';

const PLACEHOLDERS: Record<string, string> = {
  facts: "What you do, who you serve, where you’re based…",
  pricing: 'Your rates, packages, deposits…',
  policies: 'Cancellations, rescheduling, turnaround, payment terms…',
  faq: 'The questions you answer over and over — and your usual answers…',
  voice: "How you sound — warm, brief, a little playful? Paste a reply you’re proud of…",
};

/**
 * Visual groups — determines order on the page and the section header copy.
 * Keys here must exactly match MEMORY_SECTIONS keys + the two extra fields.
 */
const GROUPS: Array<{
  heading: string;
  hint: string;
  fields: string[];
}> = [
  {
    heading: 'About your business',
    hint: 'The basics your Nibbins use to keep every draft on-brand and accurate.',
    fields: ['facts', 'pricing', 'policies'],
  },
  {
    heading: 'Voice & rules',
    hint: "How you sound and what's never up for debate — Nibbins treat these as gospel.",
    fields: ['voice', 'faq', 'hard_rules', 'notes'],
  },
];

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

/** Render one textarea field with the right name, value, rows, placeholder, and hint. */
interface FieldProps {
  fieldKey: string;
  label: string;
  value: string;
  placeholder: string;
  rows: number;
  hint?: string;
}

function MemoryField({ fieldKey, label, value, placeholder, rows, hint }: FieldProps) {
  const filled = value.trim().length > 0;
  return (
    <div className={styles.field}>
      <label className={styles.label} htmlFor={fieldKey}>
        {label}
      </label>
      {hint && <p className={styles.hint}>{hint}</p>}
      <textarea
        className={`${styles.textarea} ${filled ? styles.textareaFilled : ''}`}
        id={fieldKey}
        name={fieldKey}
        rows={rows}
        defaultValue={value}
        placeholder={placeholder}
      />
    </div>
  );
}

const FIELD_META: Record<string, { label: string; rows: number; hint?: string }> = {
  facts: { label: 'Business facts', rows: 4 },
  pricing: { label: 'Pricing', rows: 3 },
  policies: { label: 'Policies', rows: 3 },
  faq: { label: 'Common questions', rows: 3 },
  voice: { label: 'Voice & tone', rows: 3 },
  hard_rules: {
    label: 'Hard rules',
    rows: 4,
    hint: 'One per line. Your Nibbins treat these as non-negotiable — never broken in a draft.',
  },
  notes: { label: 'Anything else', rows: 3 },
};

const FIELD_PLACEHOLDERS: Record<string, string> = {
  ...PLACEHOLDERS,
  hard_rules:
    'Never promise a delivery date without checking with me\nAlways address clients by first name',
  notes: 'Free notes — anything that helps your grove understand the work.',
};

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

  const fieldValues = buildFieldValues(sections, rules, notes);
  const isEmpty = allEmpty(fieldValues);

  return (
    <AppShell active="memory" title="Grove Memory" email={user.email}>
      <p className={styles.eyebrow}>Grove Memory</p>
      <h1 className={styles.h1}>What your grove knows</h1>
      <p className={styles.lede}>
        Everything here is shared with your Nibbins so their drafts sound like you — not a generic
        assistant. Edit or clear any of it, anytime; it&apos;s yours.
      </p>

      {saved && (
        <p className={styles.saved}>Saved — your grove will use this from its next draft.</p>
      )}
      {error && <p className={styles.error}>That didn&apos;t save. Give it another try.</p>}

      {isEmpty && (
        <div className={styles.firstRun}>
          <p className={styles.firstRunTitle}>Your grove doesn&apos;t know much yet</p>
          <p className={styles.firstRunBody}>
            Fill in a few sections and your Nibbins will start sounding unmistakably like you.
            Even one or two sentences per field makes a real difference.
          </p>
        </div>
      )}

      <form action={saveGroveMemory} className={styles.form}>
        {GROUPS.map((group) => {
          // Check if this group has any filled fields (for open/closed state)
          const groupHasContent = group.fields.some(
            (fk) => (fieldValues[fk] ?? '').trim().length > 0,
          );

          return (
            <details
              key={group.heading}
              className={styles.group}
              open={!isEmpty || groupHasContent}
            >
              <summary className={styles.groupSummary}>
                <span className={styles.groupHeading}>{group.heading}</span>
                <span className={styles.groupHint}>{group.hint}</span>
              </summary>

              <div className={styles.groupBody}>
                {group.fields.map((fk) => {
                  const meta = FIELD_META[fk];
                  if (!meta) return null;
                  return (
                    <MemoryField
                      key={fk}
                      fieldKey={fk}
                      label={meta.label}
                      value={fieldValues[fk] ?? ''}
                      placeholder={FIELD_PLACEHOLDERS[fk] ?? ''}
                      rows={meta.rows}
                      hint={meta.hint}
                    />
                  );
                })}
              </div>
            </details>
          );
        })}

        <button className={styles.primary} type="submit">
          Save
        </button>
      </form>
    </AppShell>
  );
}
