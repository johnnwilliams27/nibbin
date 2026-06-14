import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { createClient } from '../../../lib/supabase/server';
import { ensureAccount } from '../../../lib/auth/bootstrap';
import { upsertOwnProfile } from '../../../lib/auth/profile';
import { loadGroveState } from '../../../lib/grove/load';
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

  const { state, initialMessages, expression, credits, rowExists } = await loadGroveState(supabase, accountId, user.id);

  if (state.step === 'done') {
    // §6.2: a top-up since last visit should quietly unblock cap-queued runs.
    const { resumeQueuedRuns } = await import('../../../lib/runtime/engine');
    await resumeQueuedRuns(accountId).catch(() => 0);
  }

  return (
    <GroveChat
      initialMessages={initialMessages}
      initialExpression={expression}
      initialStep={state.step}
      keeperName={state.keeperName}
      freshHatch={!rowExists && state.step === 'ask_user_name'}
      credits={credits}
      initialProfile={state.profile}
    />
  );
}
