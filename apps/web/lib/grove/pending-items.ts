import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { PendingProposal, PendingQueue, PendingRun } from '@nibbin/keeper';

export type { PendingProposal, PendingQueue, PendingRun };

const EMPTY: PendingQueue = { proposals: [], runs: [], total: 0, hasHighStakes: false };

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
    let proposalMap = new Map<string, ProposalRow>();
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

    // ── 4. Assemble ───────────────────────────────────────────────────────────
    const total = proposals.length + runs.length;
    const hasHighStakes = proposals.some((p) => p.stakes === 'high');

    return { proposals, runs, total, hasHighStakes };
  } catch (err) {
    console.error('[pending-items] unexpected error', err instanceof Error ? err.message : err);
    return EMPTY;
  }
}
