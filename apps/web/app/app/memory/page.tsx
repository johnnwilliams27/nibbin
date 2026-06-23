import type { Metadata } from 'next';
import { appSession } from '../../../lib/auth/app-session';
import { AppShell } from '../../../components/shell/AppShell';
import { MemoryClient } from './MemoryClient';
import { seedSectionsFromAnswers } from './seedSections';
import { forwardMapLegacy, type FieldMetaRow } from './registry';
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
// F1 provenance + dynamic registry loader (graceful-empty pre-F1)
// ---------------------------------------------------------------------------

/**
 * Result shape for the combined field_meta load.
 *
 * Both halves are optional / gracefully-degraded:
 *  - `fieldMeta`  → per-field provenance (undefined if tables absent or empty)
 *  - `metaRows`   → FieldMetaRow[] for the dynamic section registry
 *                   (empty array when table absent or no rows yet)
 */
interface FieldMetaResult {
  fieldMeta: Record<string, FieldMeta> | undefined;
  metaRows: FieldMetaRow[];
}

/**
 * Loads per-field provenance AND dynamic registry rows from the `field_meta`,
 * `field_evidence`, and `sources` tables.
 *
 * Strategy:
 *   1. Query field_meta for ALL columns needed by both the registry (label,
 *      sort_order, is_custom, is_hidden) and provenance (last_reviewed_at).
 *   2. For each field, find the most recent linked source via field_evidence → sources.
 *   3. If the query throws (tables not yet in schema = pre-F1), degrade silently:
 *      return undefined fieldMeta and empty metaRows.
 *
 * The `metaRows` result activates the dynamic section registry in MemoryClient
 * (Task 6 prop). When empty (no rows, pre-migration), MemoryClient falls back
 * to the legacy static rendering for back-compat.
 *
 * Returns { fieldMeta, metaRows } — both gracefully empty on any error.
 */
async function loadFieldMetaAndRows(
  supabase: Awaited<ReturnType<typeof import('../../../lib/auth/app-session').appSession>>['supabase'],
  accountId: string,
): Promise<FieldMetaResult> {
  try {
    // 1. Load all field_meta rows for this account — include ALL registry columns
    //    (label, sort_order, is_custom, is_hidden) PLUS provenance column (last_reviewed_at).
    //    New columns (Task 1 migration) fall back gracefully if absent: PostgREST returns
    //    null for columns the query references but the row doesn't have.
    const { data: rawRows, error: metaErr } = await supabase
      .from('field_meta')
      .select('field_key, last_reviewed_at, label, sort_order, is_custom, is_hidden')
      .eq('account_id', accountId);

    if (metaErr) {
      // Table absent (pre-F1) or RLS deny → silent degrade
      return { fieldMeta: undefined, metaRows: [] };
    }
    if (!rawRows || rawRows.length === 0) {
      // No rows yet for this account — return defaults
      return { fieldMeta: undefined, metaRows: [] };
    }

    // 2. Build FieldMetaRow[] for the dynamic registry (Task 7 activation).
    //    Coerce nulls from pre-migration columns to safe defaults.
    const metaRows: FieldMetaRow[] = rawRows.map((row) => ({
      field_key: row.field_key as string,
      label: (row.label as string | null) ?? null,
      sort_order: typeof row.sort_order === 'number' ? row.sort_order : 1000,
      is_custom: typeof row.is_custom === 'boolean' ? row.is_custom : false,
      is_hidden: typeof row.is_hidden === 'boolean' ? row.is_hidden : false,
    }));

    // 3. Load field_evidence with the linked source's captured_at
    //    to determine which source "produced" each field (most recent supports link).
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
        if (!fieldSourceMap[row.field_key]) {
          fieldSourceMap[row.field_key] = (src as { kind?: string }).kind ?? 'user_entered';
        }
        // Keep the first hit; the query order is unspecified but this is best-effort
      }
    }

    // 4. Compose the FieldMeta provenance map
    const provenanceResult: Record<string, FieldMeta> = {};
    for (const row of rawRows) {
      const key = row.field_key as string;
      // Derive source: if field_evidence points to a known connector or document,
      // map it to the sourceLabel vocabulary; otherwise default to 'user_entered'.
      const rawKind = fieldSourceMap[key];
      const source = rawKind === 'connector_artifact'
        ? 'connector:gmail'   // best-effort; connector kind alone can't distinguish provider
        : rawKind === 'observation'
          ? 'field_study'
          : 'user_entered';

      provenanceResult[key] = {
        source,
        lastReviewedAt: (row.last_reviewed_at as string | null) ?? null,
      };
    }

    const fieldMeta = Object.keys(provenanceResult).length > 0 ? provenanceResult : undefined;
    return { fieldMeta, metaRows };
  } catch {
    // Any unexpected error (schema not found, type mismatch, etc.) → silent degrade
    return { fieldMeta: undefined, metaRows: [] };
  }
}

export default async function MemoryPage() {
  const { supabase, accountId, user } = await appSession();

  const { data: mem } = await supabase
    .from('grove_memory')
    .select('sections, hard_rules, notes, reference_text')
    .eq('account_id', accountId)
    .maybeSingle<MemoryRow>();

  // Min population: an empty brain seeds `about` (the neutral primary field) from
  // onboarding answers so the first visit isn't a blank page. The user then
  // curates from there. Any stored legacy `facts` values are handled by
  // forwardMapLegacy below (non-destructive: copies facts→about on read).
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

  // Apply forward-map: legacy `facts` key → `about` when `about` is empty.
  // This is a non-destructive migration: stored `facts` data continues to work.
  const rawFieldValues = buildFieldValues(sections, rules, notes);
  const fieldValues = forwardMapLegacy(rawFieldValues) as Record<string, string>;
  const isEmpty = allEmpty(fieldValues);

  // F1 provenance + dynamic registry: load field_meta rows including the new
  // columns (label, sort_order, is_custom, is_hidden) added in Task 1 migration.
  // Gracefully degrades to empty metaRows pre-migration or on any fetch error.
  // When metaRows is non-empty, MemoryClient activates the dynamic registry path;
  // when empty, it falls back to the legacy static rendering.
  const { fieldMeta, metaRows } = await loadFieldMetaAndRows(supabase, accountId);

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
        metaRows={metaRows}
      />
    </AppShell>
  );
}
