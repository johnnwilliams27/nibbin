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
