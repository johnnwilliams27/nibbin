import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { turnForState } from '@nibbin/keeper';
import { createClient } from '../../../lib/supabase/server';
import { ensureAccount } from '../../../lib/auth/bootstrap';
import { upsertOwnProfile } from '../../../lib/auth/profile';
import { stateFromRow, type GroveRow } from '../../../lib/grove/state';
import { GroveChat } from './GroveChat';

const DOWNLOAD_URL = process.env.NEXT_PUBLIC_DESKTOP_DOWNLOAD_URL ?? '#';

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
  const [{ data: row }, { data: me }, { data: balanceRow }] = await Promise.all([
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
  ]);

  const state = stateFromRow(row ?? null, me?.name ?? null);
  const turn = turnForState(state);

  const initialMessages = [...turn.messages];
  if (state.step === 'done') {
    // §6.2: a top-up since last visit should quietly unblock cap-queued runs.
    const { resumeQueuedRuns } = await import('../../../lib/runtime/engine');
    await resumeQueuedRuns(accountId).catch(() => 0);
  }

  return (
    <GroveChat
      initialMessages={initialMessages}
      initialExpression={turn.expression}
      initialStep={state.step}
      keeperName={state.keeperName}
      freshHatch={row == null && state.step === 'ask_user_name'}
      credits={balanceRow?.balance ?? 0}
      initialProfile={state.profile}
      downloadUrl={DOWNLOAD_URL}
    />
  );
}
