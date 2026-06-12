import 'server-only';

/**
 * Draft decisions (§4.1 step 7, §4.7 training): the user's approve / edit /
 * reject, recorded through the membership-checked decide_run RPC under the
 * caller's OWN session (RLS holds; the service role is not involved in the
 * trust-critical write). Events + promotion checks ride after.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { serviceClient } from '../supabase/service';
import { SupabaseEventSink } from './stores';
import { maybePromote } from './engine';

export type DraftDecision = 'approved' | 'edited' | 'rejected';

/** Bounded Levenshtein distance — drafts are short; cap keeps it honest. */
export function editDistance(a: string, b: string, cap = 2000): number {
  const s = a.slice(0, cap);
  const t = b.slice(0, cap);
  if (s === t) return 0;
  const prev = new Array<number>(t.length + 1);
  for (let j = 0; j <= t.length; j++) prev[j] = j;
  for (let i = 1; i <= s.length; i++) {
    let diag = prev[0];
    prev[0] = i;
    for (let j = 1; j <= t.length; j++) {
      const tmp = prev[j];
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diag + (s[i - 1] === t[j - 1] ? 0 : 1));
      diag = tmp;
    }
  }
  return prev[t.length];
}

export interface DecisionResult {
  decision: DraftDecision;
  /** Non-null when the decision tipped a promotion (§4.7). */
  promotedTo: string | null;
  firstApproval: boolean;
}

export async function decideDraft(
  session: SupabaseClient,
  accountId: string,
  userId: string,
  runId: string,
  decision: DraftDecision,
  distance: number,
): Promise<DecisionResult> {
  // the run's nibbin (for promotion) — read before the status flips
  const svc = serviceClient();
  const { data: run } = await svc.from('runs').select('nibbin_id, account_id').eq('id', runId).single();
  if (!run || run.account_id !== accountId) throw new Error('unknown run');

  // membership-checked, append-only, one decision per run — SQL enforced
  const { error } = await session.rpc('decide_run', {
    p_run: runId,
    p_decision: decision,
    p_edit_distance: decision === 'approved' ? 0 : distance,
  });
  if (error) throw new Error(`decision failed: ${error.message}`);

  const events = new SupabaseEventSink(svc);
  const eventName = decision === 'approved' ? 'run_approved' : decision === 'edited' ? 'run_edited' : 'run_rejected';
  await events.emit({ name: eventName, accountId, userId, props: { runId } });

  // TTFAD north star: the account's first approved draft (§6.12)
  let firstApproval = false;
  if (decision !== 'rejected') {
    const { count } = await svc
      .from('approvals')
      .select('id', { count: 'exact', head: true })
      .eq('account_id', accountId)
      .in('decision', ['approved', 'edited']);
    if ((count ?? 0) === 1) {
      firstApproval = true;
      await events.emit({ name: 'first_draft_approved', accountId, userId, props: { runId } });
    }
  }

  const promotedTo = await maybePromote(run.nibbin_id as string);
  if (promotedTo) {
    await events.emit({
      name: 'stage_promoted',
      accountId,
      userId,
      props: { nibbinId: run.nibbin_id as string, to: promotedTo },
    });
  }

  return { decision, promotedTo, firstApproval };
}
