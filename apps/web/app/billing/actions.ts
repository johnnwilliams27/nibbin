'use server';

import { redirect } from 'next/navigation';
import { createClient } from '../../lib/supabase/server';
import { ensureAccount } from '../../lib/auth/bootstrap';
import { upsertOwnProfile } from '../../lib/auth/profile';
import { siteOrigin } from '../../lib/site-url';
import { stripe } from '../../lib/stripe/client';
import { loadCatalog, priceForTier, type PurchasableTier } from '../../lib/billing/catalog';

async function currentAccount() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');
  const accountId = await ensureAccount({
    getEmail: async () => user.email ?? null,
    ensureProfile: () => upsertOwnProfile(supabase, user),
    bootstrap: async (name) => {
      const { data, error } = await supabase.rpc('bootstrap_account', { account_name: name });
      if (error) throw error;
      return data as string;
    },
  });
  return { supabase, accountId, email: user.email ?? undefined };
}

/** Find the Stripe customer for this account (by metadata) or create one. */
async function customerFor(accountId: string, email?: string): Promise<string> {
  const found = await stripe().customers.search({
    query: `metadata['account_id']:'${accountId}'`,
    limit: 1,
  });
  if (found.data[0]) return found.data[0].id;
  const created = await stripe().customers.create({ email, metadata: { account_id: accountId } });
  return created.id;
}

export async function subscribeToTier(formData: FormData) {
  const tier = String(formData.get('tier') ?? '') as PurchasableTier;
  if (tier !== 'grove' && tier !== 'canopy') redirect('/billing?error=tier');

  const { accountId, email } = await currentAccount();
  const customer = await customerFor(accountId, email);
  const origin = siteOrigin();

  const session = await stripe().checkout.sessions.create({
    mode: 'subscription',
    customer,
    client_reference_id: accountId,
    line_items: [{ price: priceForTier(tier, loadCatalog()), quantity: 1 }],
    subscription_data: { metadata: { account_id: accountId } },
    success_url: `${origin}/billing?done=subscribed`,
    cancel_url: `${origin}/billing?error=canceled`,
  });
  if (!session.url) redirect('/billing?error=checkout');
  redirect(session.url);
}

export async function buyTopups(formData: FormData) {
  const quantity = Number(formData.get('quantity') ?? '1');
  if (!Number.isInteger(quantity) || quantity < 1) redirect('/billing?error=quantity');

  const { supabase, accountId, email } = await currentAccount();
  // Top-ups are Canopy-only (§6.4) — gate on the account's current tier.
  const { data: sub } = await supabase
    .from('subscriptions')
    .select('tier')
    .eq('account_id', accountId)
    .maybeSingle();
  if (sub?.tier !== 'canopy') redirect('/billing?error=topup_tier');

  const customer = await customerFor(accountId, email);
  const origin = siteOrigin();
  const session = await stripe().checkout.sessions.create({
    mode: 'payment',
    customer,
    client_reference_id: accountId,
    line_items: [{ price: loadCatalog().topup, quantity }],
    metadata: { account_id: accountId, topup_quantity: String(quantity) },
    success_url: `${origin}/billing?done=topped_up`,
    cancel_url: `${origin}/billing?error=canceled`,
  });
  if (!session.url) redirect('/billing?error=checkout');
  redirect(session.url);
}

export async function openBillingPortal() {
  const { accountId, email } = await currentAccount();
  const customer = await customerFor(accountId, email);
  const session = await stripe().billingPortal.sessions.create({
    customer,
    return_url: `${siteOrigin()}/billing`,
  });
  redirect(session.url);
}
