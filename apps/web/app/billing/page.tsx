import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { createClient } from '../../lib/supabase/server';
import { ensureAccount } from '../../lib/auth/bootstrap';
import { TIER_CREDITS, TOPUP_CREDITS } from '../../lib/billing/grant';
import { subscribeToTier, buyTopups, openBillingPortal } from './actions';
import styles from './billing.module.css';

export const metadata: Metadata = { title: 'Plan & credits — Nibbin' };
export const dynamic = 'force-dynamic';

const NOTICES: Record<string, string> = {
  subscribed: "You're all set — your plan is active and your credits are topped up.",
  topped_up: 'Top-up added. Your credits are ready to go.',
};
const ERRORS: Record<string, string> = {
  canceled: 'No worries — nothing was charged. You can pick a plan whenever you like.',
  topup_tier: 'Top-ups are a Canopy perk. Upgrade to Canopy to add credits any time.',
  checkout: "Something went sideways starting checkout. Nothing changed — give it another go.",
  tier: 'That plan isn’t one I recognize.',
  quantity: 'Pick a whole number of top-ups.',
};

export default async function BillingPage({
  searchParams,
}: {
  searchParams: Promise<{ done?: string; error?: string }>;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const accountId = await ensureAccount({
    getEmail: async () => user.email ?? null,
    bootstrap: async (name) => {
      const { data, error } = await supabase.rpc('bootstrap_account', { account_name: name });
      if (error) throw error;
      return data as string;
    },
  });

  const { data: sub } = await supabase
    .from('subscriptions')
    .select('tier, status')
    .eq('account_id', accountId)
    .maybeSingle();
  const { data: balanceRow } = await supabase
    .from('credit_balances')
    .select('balance')
    .eq('account_id', accountId)
    .maybeSingle();

  const tier = sub?.tier ?? 'hatchling';
  const credits = balanceRow?.balance ?? 0;
  const { done, error } = await searchParams;

  return (
    <main className={styles.wrap}>
      <div className={styles.card}>
        <p className={styles.eyebrow}>Plan &amp; credits</p>
        <h1 className={styles.heading}>Your plan</h1>

        {done && NOTICES[done] && <p className={styles.notice}>{NOTICES[done]}</p>}
        {error && ERRORS[error] && (
          <p className={styles.error} role="alert">
            {ERRORS[error]}
          </p>
        )}

        <dl className={styles.stats}>
          <div className={styles.stat}>
            <dt className={styles.statLabel}>Current plan</dt>
            <dd className={styles.statValue}>{tier}</dd>
          </div>
          <div className={styles.stat}>
            <dt className={styles.statLabel}>Credits</dt>
            <dd className={styles.statValue}>{credits}</dd>
          </div>
        </dl>

        <section className={styles.plans}>
          <form action={subscribeToTier} className={styles.plan}>
            <input type="hidden" name="tier" value="grove" />
            <h2 className={styles.planName}>Grove</h2>
            <p className={styles.planPrice}>$19/mo · {TIER_CREDITS.grove.toLocaleString()} credits</p>
            <button className={styles.primary} type="submit" disabled={tier === 'grove'}>
              {tier === 'grove' ? 'Current plan' : 'Choose Grove'}
            </button>
          </form>
          <form action={subscribeToTier} className={styles.plan}>
            <input type="hidden" name="tier" value="canopy" />
            <h2 className={styles.planName}>Canopy</h2>
            <p className={styles.planPrice}>$49/mo · {TIER_CREDITS.canopy.toLocaleString()} credits</p>
            <button className={styles.primary} type="submit" disabled={tier === 'canopy'}>
              {tier === 'canopy' ? 'Current plan' : 'Choose Canopy'}
            </button>
          </form>
        </section>

        {tier === 'canopy' && (
          <form action={buyTopups} className={styles.topup}>
            <input type="hidden" name="quantity" value="1" />
            <span>Need more this month?</span>
            <button className={styles.secondary} type="submit">
              Add {TOPUP_CREDITS.toLocaleString()} credits · $5
            </button>
          </form>
        )}

        {tier !== 'hatchling' && (
          <form action={openBillingPortal}>
            <button className={styles.linkBtn} type="submit">
              Manage billing
            </button>
          </form>
        )}
      </div>
    </main>
  );
}
