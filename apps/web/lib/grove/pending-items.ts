import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { PendingConflict, PendingProposal, PendingQueue, PendingRun } from '@nibbin/keeper';

export type { PendingConflict, PendingProposal, PendingQueue, PendingRun };

const EMPTY: PendingQueue = { proposals: [], runs: [], conflicts: [], total: 0, hasHighStakes: false };

/** High-stakes field keys — conflicts on these push proactively. */
const HIGH_STAKES_FIELDS = new Set(['pricing', 'policies', 'hard_rules']);

function truncate(s: string | null | undefined, max = 80): string {
  if (!s) return '';
  return s.length > max ? s.slice(0, max - 1) + '…' : s;
}

interface NotifRow {
  id: string;
  source_id: string;
  payload: Record<string, unknown>;
  stakes: 'normal' | 'high';
  created_at: string;
}

interface ProposalRow {
  id: string;
  field_key: string;
  rationale: string | null;
}

interface RunRow {
  id: string;
  nibbins: { name: string } | null;
  run_steps: Array<{ kind: string; payload: Record<string, unknown> }>;
}

interface FlagRow {
  id: string;
  field_key: string;
  detail: string | null;
  status: string;
  detected_at: string;
}

/**
 * Read-only: returns the typed PendingQueue for the given account.
 * All queries run under the caller's RLS session — no privilege elevation (C10).
 * Plain Supabase client queries, no RPC.
 */
export async function loadPendingItems(
  supabase: SupabaseClient,
  accountId: string,
): Promise<PendingQueue> {
  try {
    // ── 1. Unread review_item notifications (ordered high-stakes first) ───────
    const { data: notifRows, error: notifErr } = await (supabase
      .from('notifications')
      .select('id, source_id, payload, stakes, created_at')
      .eq('account_id', accountId)
      .eq('kind', 'review_item')
      .is('read_at', null)
      .order('stakes', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(10) as unknown as Promise<{ data: NotifRow[] | null; error: { message: string } | null }>);

    if (notifErr) {
      console.error('[pending-items] notif query failed', notifErr.message);
      // Continue — try to still get runs
    }

    const notifs: NotifRow[] = notifRows ?? [];
    const sourceIds = notifs.map((n) => n.source_id);

    // ── 2. Proposal details (only if we have source_ids to join) ─────────────
    const proposalMap = new Map<string, ProposalRow>();
    if (sourceIds.length > 0) {
      const { data: propRows } = await (supabase
        .from('proposals')
        .select('id, field_key, rationale')
        .in('id', sourceIds) as unknown as Promise<{ data: ProposalRow[] | null; error: unknown }>);

      for (const p of propRows ?? []) {
        proposalMap.set(p.id, p);
      }
    }

    // Build PendingProposal array preserving the notification order (stakes DESC, created_at DESC)
    const proposals: PendingProposal[] = notifs.flatMap((n) => {
      const prop = proposalMap.get(n.source_id);
      if (!prop) return [];
      return [
        {
          proposalId: prop.id,
          fieldKey: prop.field_key,
          rationale: truncate(prop.rationale),
          stakes: n.stakes,
          createdAt: n.created_at,
        },
      ];
    });

    // ── 3. Awaiting-approval runs ─────────────────────────────────────────────
    const { data: runRows } = await (supabase
      .from('runs')
      .select('id, nibbins(name), run_steps(kind, payload)')
      .eq('account_id', accountId)
      .eq('status', 'awaiting_approval')
      .limit(5) as unknown as Promise<{ data: RunRow[] | null; error: unknown }>);

    const runs: PendingRun[] = (runRows ?? []).map((r) => {
      const draftStep = r.run_steps?.find((s) => s.kind === 'draft');
      const title = (draftStep?.payload?.subject as string | undefined) ?? null;
      return {
        runId: r.id,
        nibbinName: r.nibbins?.name ?? '',
        title,
      };
    });

    // ── 4. Open field_flags (needs_review) — Task 7 ──────────────────────────
    // Read-only; C10 preserved. Fail-safe: error → empty conflicts, no throw.
    let conflicts: PendingConflict[] = [];
    try {
      const { data: flagRows, error: flagErr } = await (supabase
        .from('field_flags')
        .select('id, field_key, detail, status, detected_at')
        .eq('account_id', accountId)
        .eq('status', 'needs_review')
        .limit(10) as unknown as Promise<{ data: FlagRow[] | null; error: { message: string } | null }>);

      if (flagErr) {
        console.error('[pending-items] field_flags query failed', flagErr.message);
      } else {
        conflicts = (flagRows ?? []).map((f) => ({
          fieldKey: f.field_key,
          detail: truncate(f.detail),
          stakes: HIGH_STAKES_FIELDS.has(f.field_key) ? 'high' : 'normal',
        }));
      }
    } catch (flagCatchErr) {
      console.error('[pending-items] field_flags unexpected error', flagCatchErr instanceof Error ? flagCatchErr.message : flagCatchErr);
    }

    // ── 5. Assemble ───────────────────────────────────────────────────────────
    const total = proposals.length + runs.length + conflicts.length;
    const hasHighStakes =
      proposals.some((p) => p.stakes === 'high') ||
      conflicts.some((c) => c.stakes === 'high');

    return { proposals, runs, conflicts, total, hasHighStakes };
  } catch (err) {
    console.error('[pending-items] unexpected error', err instanceof Error ? err.message : err);
    return EMPTY;
  }
}
