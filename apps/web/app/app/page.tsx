import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { createClient } from '../../lib/supabase/server';
import { ensureAccount } from '../../lib/auth/bootstrap';
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
        </dl>

        <p className={styles.note}>
          Your grove is empty for now — there&apos;s nothing to do here yet. Hatching your
          Grovekeeper and adopting your first Nibbins comes next.
        </p>

        <SignOut />
      </div>
    </main>
  );
}
