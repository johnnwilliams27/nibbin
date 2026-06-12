import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { turnForState } from '@nibbin/keeper';
import { createClient } from '../../../lib/supabase/server';
import { ensureAccount } from '../../../lib/auth/bootstrap';
import { upsertOwnProfile } from '../../../lib/auth/profile';
import { stateFromRow, type GroveRow } from '../../../lib/grove/state';
import { GroveChat } from './GroveChat';

export const metadata: Metadata = { title: 'Your grove — Nibbin' };

// Per-request session read — never statically cached.
export const dynamic = 'force-dynamic';

export default async function GrovePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  let accountId: string;
  try {
    accountId = await ensureAccount({
      getEmail: async () => user.email ?? null,
      ensureProfile: () => upsertOwnProfile(supabase, user),
      bootstrap: async (name) => {
        const { data, error } = await supabase.rpc('bootstrap_account', { account_name: name });
        if (error) throw error;
        return data as string;
      },
    });
  } catch {
    redirect('/app');
  }

  // All reads run under the user's own RLS session.
  const [{ data: row }, { data: me }, { data: balanceRow }, { count: scanCount }] = await Promise.all([
    supabase
      .from('grove_state')
      .select('keeper_name, onboarding_step, answers')
      .eq('account_id', accountId)
      .maybeSingle<GroveRow>(),
    supabase.from('users').select('name').eq('id', user.id).maybeSingle<{ name: string | null }>(),
    supabase
      .from('credit_balances')
      .select('balance')
      .eq('account_id', accountId)
      .maybeSingle<{ balance: number }>(),
    supabase
      .from('scan_results')
      .select('id', { count: 'exact', head: true })
      .eq('account_id', accountId),
  ]);

  const state = stateFromRow(row ?? null, me?.name ?? null);
  const turn = turnForState(state);

  // A draft already waiting on the user (e.g. adopted from the shop) greets
  // them on arrival — the approval is the Day-One moment, never buried.
  let pendingDraft: { runId: string; specialistName: string; title: string; draft: string } | null = null;
  const initialMessages = [...turn.messages];
  if (state.step === 'done') {
    // §6.2: a top-up since last visit should quietly unblock cap-queued runs.
    const { resumeQueuedRuns } = await import('../../../lib/runtime/engine');
    await resumeQueuedRuns(accountId).catch(() => 0);
    const { data: waiting } = await supabase
      .from('runs')
      .select('id, nibbins!inner(name)')
      .eq('account_id', accountId)
      .eq('status', 'awaiting_approval')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (waiting) {
      const { data: draftStep } = await supabase
        .from('run_steps')
        .select('payload')
        .eq('run_id', waiting.id)
        .eq('kind', 'draft')
        .maybeSingle();
      const payload = (draftStep?.payload ?? null) as { title?: string; draft?: string } | null;
      const nib = waiting.nibbins as { name: string } | Array<{ name: string }>;
      const specialistName = (Array.isArray(nib) ? nib[0]?.name : nib?.name) ?? 'Your Nibbin';
      if (payload?.draft) {
        pendingDraft = {
          runId: waiting.id,
          specialistName,
          title: payload.title ?? 'A draft for you',
          draft: payload.draft,
        };
        initialMessages.push({
          id: `pending-${waiting.id}`,
          from: 'keeper',
          card: {
            kind: 'draft_approval',
            specialistName,
            title: pendingDraft.title,
            draft: pendingDraft.draft,
            transcript: `${specialistName} drafted: ${pendingDraft.title}. ${pendingDraft.draft}`,
          },
        });
      }
    }
  }

  return (
    <GroveChat
      initialMessages={initialMessages}
      initialExpression={turn.expression}
      initialStep={state.step}
      keeperName={state.keeperName}
      freshHatch={row == null && state.step === 'ask_user_name'}
      credits={balanceRow?.balance ?? 0}
      scanned={(scanCount ?? 0) > 0}
      initialPendingDraft={pendingDraft}
    />
  );
}
