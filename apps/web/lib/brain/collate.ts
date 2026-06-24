import 'server-only';

/**
 * collate.ts — C1 Collate Pass
 *
 * Per-account nightly/periodic collate pass that:
 *   1. Seeds source_authority weights (ensure_source_authority RPC).
 *   2. Loads source_authority rows → per-kind weight map.
 *   3. Gathers per-field contributions from pending+approved proposals
 *      (joined to sources.kind) plus the current grove_memory curated value.
 *   4. Runs detectFieldConflicts; for each conflict calls flag_field_conflict RPC.
 *   5. Deduplicates pending proposals sharing the same (field_key, normalized value);
 *      keeps the earliest, sets the rest to status='superseded'.
 *   6. Counts stale fields (field_meta.last_reviewed_at < now()-60 days).
 *   7. Emits ONE morning-brief review_item notification when any count is > 0.
 *
 * All output is proposals/flags/notifications — no direct curated writes.
 * Each numbered step is fail-safe: an error is logged and remaining steps run.
 *
 * PostgREST note: all svc.rpc() calls use EXACT param names from the migration.
 */

import {
  detectFieldConflicts,
  type FieldInput,
  type SourceKind,
} from './conflict-detect';

// ── Types ─────────────────────────────────────────────────────────────────────

/** Result returned by collateAccount. */
export interface CollateResult {
  /** Number of field conflicts detected and flagged this run. */
  conflicts: number;
  /** Number of duplicate pending proposals superseded this run. */
  deduped: number;
  /** Number of fields whose last_reviewed_at < now()-STALE_DAYS. */
  stale: number;
  /** Whether a morning-brief notification was emitted. */
  briefEmitted: boolean;
}

// ── DB row types (subset of what we need) ─────────────────────────────────────

interface ProposalRow {
  id: string;
  field_key: string;
  proposed_value: string;
  source_id: string | null;
  status: string;
  created_at: string;
  sources?: { kind: string } | null;
}

interface MemoryRow {
  sections: Record<string, string>;
  hard_rules: string[];
  notes: string | null;
}

interface FieldMetaRow {
  field_key: string;
  last_reviewed_at: string | null;
}

interface AuthorityRow {
  source_kind: string;
  weight: number;
}

// ── Constants ─────────────────────────────────────────────────────────────────

/** Minimum days since last review before a field is considered stale. */
const STALE_DAYS = 60;

/** Default per-kind authority weights (mirrors ensure_source_authority seed). */
const DEFAULT_AUTHORITY: Record<SourceKind, number> = {
  document: 70,
  manual: 65,
  connector_artifact: 50,
  observation: 40,
};

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Normalize a field value the same way conflict-detect.ts does. */
function normalizeValue(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ');
}

/** Return today's date as YYYY-MM-DD. */
function todayDateString(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Safe await wrapper for DB queries: returns null on any error rather than throwing.
 * Each Supabase query builder is thenable (awaitable).
 */
async function safeAwait<T>(
  p: PromiseLike<{ data: T | null; error: unknown }>,
): Promise<T | null> {
  try {
    const { data, error } = await p;
    if (error) return null;
    return data ?? null;
  } catch {
    return null;
  }
}

// ── Core ──────────────────────────────────────────────────────────────────────

/**
 * Run the C1 collate pass for a single account.
 *
 * @param svc        Supabase service-role client.
 * @param accountId  The account UUID to collate.
 * @returns          Counts of activity performed this run.
 */
export async function collateAccount(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  svc: any,
  accountId: string,
): Promise<CollateResult> {
  let conflicts = 0;
  let deduped = 0;
  let stale = 0;

  // ── Step 1: Seed + load source_authority ─────────────────────────────────

  const authority: Record<string, number> = { ...DEFAULT_AUTHORITY };

  try {
    await svc.rpc('ensure_source_authority', { p_account: accountId });

    const authRows = await safeAwait<AuthorityRow[]>(
      svc.from('source_authority') as PromiseLike<{ data: AuthorityRow[] | null; error: unknown }>,
    );
    if (authRows) {
      for (const row of authRows) {
        authority[row.source_kind] = row.weight;
      }
    }
  } catch (err) {
    console.error(
      '[collate] step 1 (ensure_source_authority/load) failed:',
      err instanceof Error ? err.message : String(err),
    );
    // Proceed with default authority weights
  }

  // ── Step 2: Load proposals and grove_memory ───────────────────────────────

  let proposals: ProposalRow[] = [];

  try {
    const proposalRows = await safeAwait<ProposalRow[]>(
      svc.from('proposals') as PromiseLike<{ data: ProposalRow[] | null; error: unknown }>,
    );
    if (proposalRows) proposals = proposalRows;
  } catch (err) {
    console.error('[collate] step 2 (load proposals) failed:', err instanceof Error ? err.message : String(err));
  }

  let memory: MemoryRow = { sections: {}, hard_rules: [], notes: null };

  try {
    const memRow = await safeAwait<MemoryRow>(
      svc.from('grove_memory') as PromiseLike<{ data: MemoryRow | null; error: unknown }>,
    );
    if (memRow) memory = memRow;
  } catch (err) {
    console.error('[collate] step 2 (load grove_memory) failed:', err instanceof Error ? err.message : String(err));
  }

  // ── Step 3: Conflict detection ─────────────────────────────────────────────

  try {
    // Group proposals by field_key, collect source contributions
    const fieldMap = new Map<string, Array<{ sourceId: string; sourceKind: SourceKind; value: string }>>();

    for (const p of proposals) {
      if (!p.source_id) continue;
      const kind = p.sources?.kind as SourceKind | undefined;
      if (!kind) continue;
      if (!fieldMap.has(p.field_key)) fieldMap.set(p.field_key, []);
      fieldMap.get(p.field_key)!.push({
        sourceId: p.source_id,
        sourceKind: kind,
        value: p.proposed_value,
      });
    }

    // Build FieldInput array with current curated value per field
    const fields: FieldInput[] = [];
    for (const [fieldKey, contributions] of fieldMap.entries()) {
      let currentValue = '';
      if (fieldKey === 'notes') {
        currentValue = memory.notes ?? '';
      } else if (fieldKey === 'hard_rules') {
        currentValue = memory.hard_rules.join('\n');
      } else {
        currentValue = memory.sections[fieldKey] ?? '';
      }
      fields.push({ fieldKey, currentValue, contributions });
    }

    // Build typed authority record
    const typedAuthority: Record<SourceKind, number> = {
      document: authority['document'] ?? DEFAULT_AUTHORITY.document,
      manual: authority['manual'] ?? DEFAULT_AUTHORITY.manual,
      connector_artifact: authority['connector_artifact'] ?? DEFAULT_AUTHORITY.connector_artifact,
      observation: authority['observation'] ?? DEFAULT_AUTHORITY.observation,
    };

    const detected = detectFieldConflicts(fields, typedAuthority);

    for (const conflict of detected) {
      try {
        await svc.rpc('flag_field_conflict', {
          p_account: accountId,
          p_field_key: conflict.fieldKey,
          p_competing_source_ids: conflict.competingSourceIds,
          p_detail: conflict.detail,
          p_stakes: conflict.stakes,
          p_suggested_source_id: conflict.suggestedSourceId,
        });
        conflicts++;
      } catch (flagErr) {
        console.error(
          '[collate] flag_field_conflict failed for field', conflict.fieldKey, ':',
          flagErr instanceof Error ? flagErr.message : String(flagErr),
        );
      }
    }
  } catch (err) {
    console.error('[collate] step 3 (conflict detection) failed:', err instanceof Error ? err.message : String(err));
  }

  // ── Step 4: Dedup pending proposals ───────────────────────────────────────

  try {
    const pending = proposals.filter((p) => p.status === 'pending');

    // Group by (field_key, normalized proposed_value)
    const groups = new Map<string, ProposalRow[]>();
    for (const p of pending) {
      const key = `${p.field_key}|||${normalizeValue(p.proposed_value)}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(p);
    }

    for (const group of groups.values()) {
      if (group.length <= 1) continue;

      // Sort ascending by created_at — oldest first (keep it)
      const sorted = [...group].sort(
        (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
      );
      const dupIds = sorted.slice(1).map((p) => p.id);
      if (dupIds.length === 0) continue;

      try {
        await svc.from('proposals').update({ status: 'superseded' }).in('id', dupIds);
        deduped += dupIds.length;
      } catch (updateErr) {
        console.error(
          '[collate] dedup update failed:',
          updateErr instanceof Error ? updateErr.message : String(updateErr),
        );
      }
    }
  } catch (err) {
    console.error('[collate] step 4 (dedup) failed:', err instanceof Error ? err.message : String(err));
  }

  // ── Step 5: Stale field count ──────────────────────────────────────────────

  try {
    const metaRows = await safeAwait<FieldMetaRow[]>(
      svc.from('field_meta') as PromiseLike<{ data: FieldMetaRow[] | null; error: unknown }>,
    );
    if (metaRows) {
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - STALE_DAYS);
      for (const row of metaRows) {
        if (
          row.last_reviewed_at === null ||
          new Date(row.last_reviewed_at).getTime() < cutoff.getTime()
        ) {
          stale++;
        }
      }
    }
  } catch (err) {
    console.error('[collate] step 5 (stale count) failed:', err instanceof Error ? err.message : String(err));
  }

  // ── Step 6: Morning brief ─────────────────────────────────────────────────

  let briefEmitted = false;

  if (conflicts > 0 || deduped > 0 || stale > 0) {
    try {
      const dateStr = todayDateString();
      const sourceId = `collate:${dateStr}`;

      const parts: string[] = [];
      if (conflicts > 0) parts.push(`${conflicts} conflict${conflicts === 1 ? '' : 's'}`);
      if (deduped > 0) parts.push(`${deduped} duplicate${deduped === 1 ? '' : 's'} removed`);
      if (stale > 0) parts.push(`${stale} stale field${stale === 1 ? '' : 's'}`);
      const body = parts.join(', ');

      await svc.rpc('insert_system_notification', {
        p_account: accountId,
        p_kind: 'review_item',
        p_source_id: sourceId,
        p_title: 'Your morning brief',
        p_body: body,
        p_payload: { kind: 'morning_brief', conflicts, deduped, stale },
        p_stakes: 'normal',
      });

      briefEmitted = true;
    } catch (briefErr) {
      console.error(
        '[collate] step 6 (morning brief) failed:',
        briefErr instanceof Error ? briefErr.message : String(briefErr),
      );
    }
  }

  return { conflicts, deduped, stale, briefEmitted };
}
