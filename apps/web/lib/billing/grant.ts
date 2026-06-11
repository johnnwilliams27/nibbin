/**
 * Translate a paid Stripe event into a credit-ledger row. Pure: the webhook
 * inserts the returned row via the service role; the DB's append-only triggers,
 * sign-by-reason CHECKs, and the unique (account_id, source_id) grant index are
 * the final authority. source_id is the Stripe object id (invoice / payment),
 * which makes grants idempotent under webhook retries.
 */
import { TIERS, TOP_UP, grantEntry, topUpEntry } from '@nibbin/shared';
import type { PurchasableTier } from './catalog';

export interface LedgerInsert {
  account_id: string;
  delta: number;
  reason: 'grant' | 'topup';
  source_id: string;
}

function assertId(v: string, what: string): void {
  if (typeof v !== 'string' || v.trim() === '') throw new Error(`${what} must be a non-blank string`);
}

/** Monthly subscription grant for a paid tier, keyed to the billing PERIOD. */
export function buildGrant(accountId: string, tier: PurchasableTier, sourceId: string): LedgerInsert {
  assertId(accountId, 'account_id');
  assertId(sourceId, 'grant source id');
  // grantEntry validates sign-by-reason + the source key; reuse it as the source of truth.
  const entry = grantEntry(tier, sourceId);
  return { account_id: accountId, delta: entry.delta, reason: 'grant', source_id: sourceId };
}

/**
 * Idempotency key for a subscription grant: the billing PERIOD, not the invoice.
 * Any second invoice in the same period (mid-period upgrade proration, etc.)
 * reuses this key and is deduped by the unique (account_id, source_id) grant
 * index — so an upgrade can't double-grant a month (gate logic-skeptic P1).
 */
export function subscriptionGrantKey(subscriptionId: string, periodStart: number): string {
  if (!subscriptionId || !Number.isFinite(periodStart)) throw new Error('invalid grant key inputs');
  return `sub_${subscriptionId}_p${periodStart}`;
}

/** Grant only when the invoice actually moved money — never on a $0/trial invoice (P1). */
export function shouldGrantForInvoice(amountPaid: number): boolean {
  return Number.isFinite(amountPaid) && amountPaid > 0;
}

/** One-time top-up grant (Canopy only), keyed to the Stripe payment. */
export function buildTopup(accountId: string, quantity: number, paymentId: string): LedgerInsert {
  assertId(accountId, 'account_id');
  assertId(paymentId, 'payment id');
  // topUpEntry enforces a positive whole quantity and Canopy-only purchase.
  const entry = topUpEntry('canopy', quantity);
  return { account_id: accountId, delta: entry.delta, reason: 'topup', source_id: paymentId };
}

/** Convenience: credits a tier grants per period (for UI copy). */
export const TIER_CREDITS = {
  hatchling: TIERS.hatchling.monthlyCredits,
  grove: TIERS.grove.monthlyCredits,
  canopy: TIERS.canopy.monthlyCredits,
} as const;

export const TOPUP_CREDITS = TOP_UP.credits;
