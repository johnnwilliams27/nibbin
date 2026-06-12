import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { createClient } from '../../lib/supabase/server';
import { ensureAccount } from '../../lib/auth/bootstrap';
import { upsertOwnProfile } from '../../lib/auth/profile';
import styles from './app.module.css';

export const metadata: Metadata = { title: 'Your grove — Nibbin' };

// Force dynamic: this page reads the per-request session.
export const dynamic = 'force-dynamic';

function SignOut() {
  return (
    <form action="/auth/signout" method="post">
      <button className={styles.signout} type="submit">
        Sign out
      </button>
    </form>
  );
}

export default async function AppPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  // Idempotent + race-safe (advisory-locked RPC). Safe to run on every load.
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
    // Render the snag inline — redirecting to /login would just bounce back here
    // (middleware sends signed-in users to /app), looping the user.
    return (
      <main className={styles.wrap}>
        <div className={styles.card}>
          <p className={styles.eyebrow}>Your grove</p>
          <h1 className={styles.heading}>Just a moment</h1>
          <p className={styles.body}>
            You&apos;re signed in, but I hit a snag setting up your grove. Refresh in a moment and
            it should settle.
          </p>
          <p className={styles.note} />
          <SignOut />
        </div>
      </main>
    );
  }

  // Every read below is gated by RLS on the user's own session — this is the
  // live demonstration that membership scoping holds at the database layer.
  const { data: grove } = await supabase
    .from('grove_state')
    .select('keeper_name, onboarding_step')
    .eq('account_id', accountId)
    .maybeSingle();
  // A grove that hasn't finished hatching pulls the user back into the
  // ceremony (§4.1 steps 2–3) — the dashboard comes after.
  if (!grove || grove.onboarding_step !== 'done') redirect('/app/grove');

  const { data: account } = await supabase
    .from('accounts')
    .select('name')
    .eq('id', accountId)
    .single();
  const { data: balanceRow } = await supabase
    .from('credit_balances')
    .select('balance')
    .eq('account_id', accountId)
    .maybeSingle();
  const credits = balanceRow?.balance ?? 0;

  const [{ data: nibbins }, { count: waitingCount }, { count: queuedCount }] = await Promise.all([
    supabase
      .from('nibbins')
      .select('id, name, stage, status')
      .eq('account_id', accountId)
      .eq('kind', 'specialist')
      .order('hatched_at', { ascending: true }),
    supabase
      .from('runs')
      .select('id', { count: 'exact', head: true })
      .eq('account_id', accountId)
      .eq('status', 'awaiting_approval'),
    supabase
      .from('runs')
      .select('id', { count: 'exact', head: true })
      .eq('account_id', accountId)
      .eq('status', 'queued'),
  ]);
  const stageLabel: Record<string, string> = { egg: 'Egg', student: 'Student', senior: 'Senior', grad: 'Graduate' };

  return (
    <main className={styles.wrap}>
      <div className={styles.card}>
        <p className={styles.eyebrow}>Your grove</p>
        <h1 className={styles.heading}>{account?.name ?? 'Your grove'}</h1>
        <p className={styles.body}>
          You&apos;re signed in as <strong>{user.email}</strong>.
        </p>

        <dl className={styles.stats}>
          <div className={styles.stat}>
            <dt className={styles.statLabel}>Credits</dt>
            <dd className={styles.statValue}>{credits}</dd>
          </div>
          <div className={styles.stat}>
            <dt className={styles.statLabel}>Waiting on you</dt>
            <dd className={styles.statValue}>{waitingCount ?? 0}</dd>
          </div>
        </dl>

        {(queuedCount ?? 0) > 0 && (
          <p className={styles.note} role="status">
            {queuedCount} {queuedCount === 1 ? 'task is' : 'tasks are'} waiting for credits — they
            run the moment the meter refills. <a href="/billing">Top up or change plan</a>.
          </p>
        )}

        {(nibbins ?? []).length > 0 && (
          <p className={styles.body}>
            Your grove:{' '}
            {(nibbins ?? [])
              .map((n) => `${n.name} (${stageLabel[n.stage] ?? n.stage}${n.status !== 'active' ? `, ${n.status}` : ''})`)
              .join(' · ')}
          </p>
        )}

        <p className={styles.note}>
          {grove.keeper_name} is keeping the grove — <a href="/app/grove">step in and say hello</a>.{' '}
          <a href="/app/shop">Browse the Agent Shop</a>
          {(waitingCount ?? 0) > 0 ? (
            <>
              {' '}
              — and {waitingCount === 1 ? 'a draft is' : 'drafts are'}{' '}
              <a href="/app/grove">waiting on your yes</a>.
            </>
          ) : (
            '.'
          )}
        </p>

        <SignOut />
      </div>
    </main>
  );
}
