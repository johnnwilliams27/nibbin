import 'server-only';

/**
 * Draft decisions (§4.1 step 7, §4.7 training): the user's approve / edit /
 * reject, recorded through the membership-checked decide_run RPC under the
 * caller's OWN session (RLS holds; the service role is not involved in the
 * trust-critical write). Events + promotion checks ride after.
 *
 * decideViaChannel: channel-originated approvals. The caller has no user
 * session — all writes use the service role through decide_run_service, which
 * self-defends actor membership, run-awaiting-approval, draft-step presence,
 * and one-per-run uniqueness in SQL. The TS layer pre-validates the binding
 * and run ownership so the RPC is NEVER reached for an unverified sender, a
 * non-member actor, or a run not owned by the binding's account.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { after } from 'next/server';
import { serviceClient } from '../supabase/service';
import { SupabaseEventSink } from './stores';
import { maybePromote } from './engine';
import { maybeDriftNudge } from './drift';
import { writeMemoryFromDecision } from '../memory/extract';

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

/**
 * Shared post-decision side-effects: event emission, TTFAD tracking,
 * promotion check, and drift nudge. Called by both decideDraft (session path)
 * and decideViaChannel (service path) so the observable downstream behaviour
 * is identical regardless of how the decision was recorded.
 *
 * @param svc - service client (bypasses RLS; already created by the caller)
 * @param accountId - owning account
 * @param userId - actor whose id appears in emitted events (linked_by for channel path)
 * @param runId - the run that was just decided
 * @param nibbinId - the nibbin that owns the run
 * @param decision - the decision that was recorded
 */
async function applyDecisionEffects(
  svc: SupabaseClient,
  accountId: string,
  userId: string,
  runId: string,
  nibbinId: string,
  decision: DraftDecision,
): Promise<{ promotedTo: string | null; firstApproval: boolean }> {
  const events = new SupabaseEventSink(svc);
  const eventName =
    decision === 'approved' ? 'run_approved' : decision === 'edited' ? 'run_edited' : 'run_rejected';
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

  const promotedTo = await maybePromote(nibbinId);
  if (promotedTo) {
    await events.emit({
      name: 'stage_promoted',
      accountId,
      userId,
      props: { nibbinId, to: promotedTo },
    });
  }

  // R2: a degrading Senior/Grad gets a calm, human-only nudge (best-effort).
  await maybeDriftNudge(svc, accountId, nibbinId);

  return { promotedTo, firstApproval };
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

  const eff = await applyDecisionEffects(svc, accountId, userId, runId, run.nibbin_id as string, decision);

  // §12A: learn durable memory from this decision — EDITED-ONLY (the rich
  // correction signal; approvals are unedited-by-definition + the common hot
  // case, rejections low-signal) and DEFERRED via after() so it runs
  // post-response and never adds an LLM call to the decision latency.
  // Best-effort throughout — the writer swallows its own errors and re-checks
  // redaction on every entry; after() survives the serverless response unlike a
  // bare fire-and-forget.
  if (decision === 'edited') {
    try {
      after(() => {
        void writeMemoryFromDecision({
          accountId,
          userId,
          runId,
          nibbinId: run.nibbin_id as string,
          decision,
        });
      });
    } catch {
      /* not in a request context (e.g. a test/script) — memory is best-effort, skip */
    }
  }

  return { decision, promotedTo: eff.promotedTo, firstApproval: eff.firstApproval };
}

/**
 * Approve or reject a run via a verified notification channel (Telegram, SMS,
 * email, etc.). This path has NO user session — all writes go through the
 * service role. The security invariant is: an unverified sender, a non-member
 * linked_by, or a run not owned by the binding's account / not awaiting
 * approval must ALL return null with zero state change. Only a fully-verified
 * chain reaches decide_run_service.
 *
 * Security chain (each step returns null on failure — NO rpc call before step e):
 *   a. verified binding exists  (channel + external_id + status='verified')
 *   b. linked_by is non-null   (binding must carry an attributable actor)
 *   c. linked_by is active member of the binding's account
 *   d. run belongs to that account AND is in 'awaiting_approval' status
 *   e. decide_run_service RPC (SQL re-guards a/b/c/d + one-per-run)
 *   f. applyDecisionEffects (events, TTFAD, promotion, drift nudge)
 */
export async function decideViaChannel(
  channel: string,
  externalId: string,
  runId: string,
  decision: 'approved' | 'rejected',
): Promise<DecisionResult | null> {
  const svc = serviceClient();

  // Step a: resolve verified binding
  const { data: binding } = await svc
    .from('notification_channels')
    .select('account_id, linked_by')
    .eq('channel', channel)
    .eq('external_id', externalId)
    .eq('status', 'verified')
    .maybeSingle();
  if (!binding) return null; // unverified sender — anti-spoof, no-op

  // Step b: linked_by must be set (binding must carry an attributable actor)
  const linkedBy = binding.linked_by as string | null;
  if (!linkedBy) return null;

  const accountId = binding.account_id as string;

  // Step c: verify linked_by is an active member of the binding's account
  const { count: memberCount } = await svc
    .from('memberships')
    .select('id', { count: 'exact', head: true })
    .eq('account_id', accountId)
    .eq('user_id', linkedBy)
    .eq('status', 'active');
  if ((memberCount ?? 0) === 0) return null; // non-member actor — clean reject

  // Step d: verify run belongs to binding's account and is awaiting_approval
  const { data: run } = await svc
    .from('runs')
    .select('nibbin_id, account_id, status')
    .eq('id', runId)
    .maybeSingle();
  if (!run) return null; // run not found
  if ((run.account_id as string) !== accountId) return null; // cross-account attempt
  if ((run.status as string) !== 'awaiting_approval') return null; // not pending

  // Step e: call the service-role RPC (SQL re-validates everything)
  const { error } = await svc.rpc('decide_run_service', {
    p_run: runId,
    p_actor_user: linkedBy,
    p_decision: decision,
    p_edit_distance: 0,
  });
  if (error) throw new Error('decision failed: ' + error.message);

  // Step f: post-decision side-effects (events, TTFAD, promotion, drift nudge)
  const eff = await applyDecisionEffects(svc, accountId, linkedBy, runId, run.nibbin_id as string, decision);
  return { decision, promotedTo: eff.promotedTo, firstApproval: eff.firstApproval };
}
