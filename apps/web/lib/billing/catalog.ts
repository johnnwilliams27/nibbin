/**
 * Stripe price ↔ Nibbin tier mapping. Price ids come from env (they differ per
 * Stripe account/mode) — pure resolvers take the catalog explicitly so they're
 * unit-tested without env; loadCatalog() reads it lazily at request time.
 */
export type PurchasableTier = 'grove' | 'canopy';
export type PriceKind = PurchasableTier | 'topup';

export interface PriceCatalog {
  grove: string;
  canopy: string;
  topup: string;
}

export function tierForPrice(priceId: string, c: PriceCatalog): PriceKind | null {
  if (priceId === c.grove) return 'grove';
  if (priceId === c.canopy) return 'canopy';
  if (priceId === c.topup) return 'topup';
  return null;
}

export function priceForTier(tier: PurchasableTier, c: PriceCatalog): string {
  return c[tier];
}

export function loadCatalog(): PriceCatalog {
  const grove = process.env.STRIPE_PRICE_GROVE;
  const canopy = process.env.STRIPE_PRICE_CANOPY;
  const topup = process.env.STRIPE_PRICE_TOPUP;
  if (!grove || !canopy || !topup) {
    throw new Error('Missing STRIPE_PRICE_GROVE / STRIPE_PRICE_CANOPY / STRIPE_PRICE_TOPUP');
  }
  return { grove, canopy, topup };
}
