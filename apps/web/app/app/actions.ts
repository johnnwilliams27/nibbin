'use server';

/**
 * Grove Home draft decisions — the "Approve & send" button on the Today feed.
 *
 * This is NOT a new approval mechanism: it reuses the exact existing path the
 * grove already uses — the membership-checked `decide_run` RPC via the shared
 * `decideDraft` helper (lib/runtime/decide.ts), under the caller's own RLS
 * session. Editing a draft stays a chat interaction with the Keeper (the edit
 * distance that feeds the §4.7 promotion window is computed there), so the
 * "Edit first" control links into the grove panel rather than approving here.
 */
import { revalidatePath } from 'next/cache';
import { appSession } from '../../lib/auth/app-session';
import { decideDraft, type DraftDecision } from '../../lib/runtime/decide';
import { createClient } from '../../lib/supabase/server';

/**
 * Grove Home proposal decisions — inline Approve/Reject for pending memory
 * proposals (Task 6 of P6 attention-queue).
 *
 * Delegates to the F2 `decide_memory_proposal` RPC, which is the single logged
 * curated-write/ratify path. The action runs under the user's own RLS session
 * (via createClient), so the RPC's internal `is_account_member` check applies.
 * No privilege elevation.
 *
 * IMPORTANT — RPC arg names: the Foundation RPC signature is
 *   decide_memory_proposal(p_proposal_id uuid, p_decision text)
 * The call MUST use exactly { p_proposal_id, p_decision } — wrong key names
 * produce a Postgres "function does not exist" error even though mocked tests
 * would pass. See arg-name regression test 6g in actions.test.ts.
 */
export async function decideProposalAction(
  formData: FormData,
): Promise<{ error?: string }> {
  const proposalId = formData.get('proposalId');
  const decision = formData.get('decision');

  if (typeof proposalId !== 'string' || !proposalId) {
    return { error: 'missing proposalId' };
  }
  if (decision !== 'approved' && decision !== 'rejected') {
    return { error: 'invalid decision' };
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc('decide_memory_proposal', {
    p_proposal_id: proposalId,
    p_decision: decision,
  });
  if (error) return { error: error.message };

  revalidatePath('/app');
  return {};
}

export async function decideRunAction(formData: FormData): Promise<void> {
  const runId = String(formData.get('runId') ?? '');
  const decision = String(formData.get('decision') ?? '') as DraftDecision;
  if (!runId) throw new Error('missing run');
  if (decision !== 'approved' && decision !== 'rejected') {
    // The home feed only offers the unedited yes/no; edits go through the grove
    // panel where the edited text (and its edit distance) is captured.
    throw new Error('unsupported decision');
  }

  const { supabase, user, accountId } = await appSession();
  // distance 0: an approve from the feed is an unedited yes (decide_run enforces
  // approved ⇒ distance 0 in SQL; a reject carries no edit).
  await decideDraft(supabase, accountId, user.id, runId, decision, 0);

  revalidatePath('/app');
}
