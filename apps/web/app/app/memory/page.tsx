import type { Metadata } from 'next';
import { appSession } from '../../../lib/auth/app-session';
import { AppShell } from '../../../components/shell/AppShell';
import { MemoryClient } from './MemoryClient';
import type { FieldMeta } from './provenance';
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

// ---------------------------------------------------------------------------
// F1 provenance loader (graceful-empty pre-F1)
// ---------------------------------------------------------------------------

/**
 * Loads per-field provenance from F1's `field_meta` + `field_evidence` + `sources` tables.
 *
 * Strategy:
 *   1. Query field_meta for last_reviewed_at per field.
 *   2. For each field, find the most recent linked source via field_evidence → sources.
 *   3. If either query throws (tables not yet in schema = pre-F1), return undefined silently.
 *
 * The source linked to a field is determined by the most-recently-captured supporting
 * field_evidence row's source. This is the "which source produced the field" signal.
 *
 * Returns: Record<fieldKey, FieldMeta> or undefined (pre-F1 / any fetch error).
 */
async function loadFieldMeta(
  supabase: Awaited<ReturnType<typeof import('../../../lib/auth/app-session').appSession>>['supabase'],
  accountId: string,
): Promise<Record<string, FieldMeta> | undefined> {
  try {
    // 1. Load all field_meta rows for this account
    const { data: metaRows, error: metaErr } = await supabase
      .from('field_meta')
      .select('field_key, last_reviewed_at')
      .eq('account_id', accountId);

    if (metaErr) return undefined; // table absent or RLS deny → silent
    if (!metaRows || metaRows.length === 0) return undefined; // no data yet

    // 2. Load field_evidence with the linked source's captured_at
    // to determine which source "produced" each field (most recent supports link).
    const { data: evidenceRows, error: evErr } = await supabase
      .from('field_evidence')
      .select('field_key, source_id, sources!inner(kind, captured_at)')
      .eq('account_id', accountId)
      .eq('relationship', 'supports');

    // evidence errors are non-fatal — we degrade to "user_entered" for all fields
    const evidenceOk = !evErr && Array.isArray(evidenceRows);

    // Build field_key → most-recently-linked source kind map
    const fieldSourceMap: Record<string, string> = {};
    if (evidenceOk) {
      for (const row of evidenceRows!) {
        const src = Array.isArray(row.sources) ? row.sources[0] : row.sources;
        if (!src) continue;
        const existing = fieldSourceMap[row.field_key];
        if (!existing) {
          fieldSourceMap[row.field_key] = src.kind ?? 'user_entered';
        }
        // Keep the first hit; the query order is unspecified but this is best-effort
      }
    }

    // 3. Compose the FieldMeta map
    const result: Record<string, FieldMeta> = {};
    for (const row of metaRows) {
      const key = row.field_key as string;
      // Derive source: if field_evidence points to a known connector or document,
      // map it to the sourceLabel vocabulary; otherwise default to 'user_entered'.
      const rawKind = fieldSourceMap[key];
      const source = rawKind === 'connector_artifact'
        ? 'connector:gmail'   // best-effort; connector kind alone can't distinguish provider
        : rawKind === 'observation'
          ? 'field_study'
          : 'user_entered';

      result[key] = {
        source,
        lastReviewedAt: row.last_reviewed_at as string | null ?? null,
      };
    }

    return Object.keys(result).length > 0 ? result : undefined;
  } catch {
    // Any unexpected error (schema not found, type mismatch, etc.) → silent
    return undefined;
  }
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

  // F1 provenance: try/catch — silently undefined pre-F1 or on any fetch error.
  // When present, the per-field FieldMeta drives the provenance slot in FieldBlock.
  const fieldMeta = await loadFieldMeta(supabase, accountId);

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
        fieldMeta={fieldMeta}
      />
    </AppShell>
  );
}
