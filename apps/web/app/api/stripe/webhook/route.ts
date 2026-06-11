import { NextResponse, type NextRequest } from 'next/server';
import type Stripe from 'stripe';
import { stripe, webhookSecret } from '../../../../lib/stripe/client';
import { serviceClient } from '../../../../lib/supabase/service';
import { TOP_UP } from '@nibbin/shared';
import { loadCatalog, tierForPrice, type PurchasableTier } from '../../../../lib/billing/catalog';
import { buildGrant, buildTopup, type LedgerInsert } from '../../../../lib/billing/grant';

// Stripe signature verification needs the raw body + Node crypto.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Insert a ledger row; treat the unique-grant collision (23505) as an idempotent no-op. */
async function applyLedger(row: LedgerInsert): Promise<void> {
  const { error } = await serviceClient().from('credit_ledger').insert(row);
  if (error && error.code !== '23505') throw new Error(`ledger insert failed: ${error.message}`);
}

async function accountIdForCustomer(customerId: string): Promise<string | null> {
  const customer = await stripe().customers.retrieve(customerId);
  if (customer.deleted) return null;
  return (customer.metadata?.account_id as string | undefined) ?? null;
}

/** Re-verify Canopy at grant time — top-ups are Canopy-only (§6.4), not just at checkout. */
async function isCanopy(accountId: string): Promise<boolean> {
  const { data } = await serviceClient()
    .from('subscriptions')
    .select('tier')
    .eq('account_id', accountId)
    .maybeSingle();
  return data?.tier === 'canopy';
}

async function upsertSubscription(fields: {
  account_id: string;
  tier: PurchasableTier | 'hatchling';
  status: string;
  stripe_customer_id: string;
  period_end: string | null;
}): Promise<void> {
  const { error } = await serviceClient()
    .from('subscriptions')
    .upsert(fields, { onConflict: 'account_id' });
  if (error) throw new Error(`subscription upsert failed: ${error.message}`);
}

async function handleSubscription(subscriptionId: string, invoiceId: string | null): Promise<void> {
  const sub = await stripe().subscriptions.retrieve(subscriptionId);
  const customerId = typeof sub.customer === 'string' ? sub.customer : sub.customer.id;
  const accountId = await accountIdForCustomer(customerId);
  if (!accountId) return; // not a Nibbin-originated customer

  const priceId = sub.items.data[0]?.price.id ?? '';
  const kind = tierForPrice(priceId, loadCatalog());
  if (kind !== 'grove' && kind !== 'canopy') return;

  const periodEnd = sub.items.data[0]?.current_period_end ?? null;
  await upsertSubscription({
    account_id: accountId,
    tier: kind,
    status: sub.status,
    stripe_customer_id: customerId,
    period_end: periodEnd ? new Date(periodEnd * 1000).toISOString() : null,
  });

  // The monthly credit grant is keyed to the paid invoice (idempotent on retry).
  if (invoiceId && (sub.status === 'active' || sub.status === 'trialing')) {
    await applyLedger(buildGrant(accountId, kind, invoiceId));
  }
}

export async function POST(request: NextRequest) {
  const sig = request.headers.get('stripe-signature');
  if (!sig) return new NextResponse('missing signature', { status: 400 });

  const raw = await request.text();
  let event: Stripe.Event;
  try {
    event = stripe().webhooks.constructEvent(raw, sig, webhookSecret());
  } catch {
    // Generic response — don't echo verification internals to the caller (P3).
    return new NextResponse('invalid signature', { status: 400 });
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object;
        if (session.mode === 'subscription' && session.subscription) {
          const subId =
            typeof session.subscription === 'string' ? session.subscription : session.subscription.id;
          await handleSubscription(subId, null);
        } else if (session.mode === 'payment') {
          // one-time top-up
          const accountId = session.client_reference_id ?? (session.metadata?.account_id as string | undefined);
          // Quantity from the amount ACTUALLY paid, never trusted metadata (P2).
          const quantity = Math.floor((session.amount_total ?? 0) / TOP_UP.priceUsdCents);
          const paymentId =
            (typeof session.payment_intent === 'string' ? session.payment_intent : session.payment_intent?.id) ??
            session.id;
          // Re-verify Canopy at grant time (P1) — the checkout gate alone is not enough.
          if (accountId && quantity > 0 && (await isCanopy(accountId))) {
            await applyLedger(buildTopup(accountId, quantity, paymentId));
          }
        }
        break;
      }
      case 'invoice.paid': {
        const invoice = event.data.object as Stripe.Invoice & { subscription?: string | Stripe.Subscription | null };
        const subRef = invoice.subscription;
        const subId = typeof subRef === 'string' ? subRef : subRef?.id;
        if (subId) await handleSubscription(subId, invoice.id ?? null);
        break;
      }
      case 'customer.subscription.updated':
      case 'customer.subscription.deleted': {
        const sub = event.data.object;
        const customerId = typeof sub.customer === 'string' ? sub.customer : sub.customer.id;
        const accountId = await accountIdForCustomer(customerId);
        if (accountId) {
          const priceId = sub.items.data[0]?.price.id ?? '';
          const kind = tierForPrice(priceId, loadCatalog());
          const tier = kind === 'grove' || kind === 'canopy' ? kind : 'hatchling';
          // Cancel/downgrade never deletes the grove (§6.4) — only the status changes.
          await upsertSubscription({
            account_id: accountId,
            tier: event.type === 'customer.subscription.deleted' ? 'hatchling' : tier,
            status: event.type === 'customer.subscription.deleted' ? 'canceled' : sub.status,
            stripe_customer_id: customerId,
            period_end: null,
          });
        }
        break;
      }
      default:
        break;
    }
  } catch (e) {
    // Return 500 so Stripe retries; grant + top-up are both idempotent (unique
    // (account_id, source_id) per reason), so retries can't double-credit.
    console.error('stripe webhook handler error', e);
    return new NextResponse('handler error', { status: 500 });
  }

  return NextResponse.json({ received: true });
}
