import { describe, it, expect } from 'vitest';
import { tierForPrice, priceForTier, type PriceCatalog } from './catalog';

const CATALOG: PriceCatalog = {
  grove: 'price_grove',
  canopy: 'price_canopy',
  topup: 'price_topup',
};

describe('price ↔ tier catalog', () => {
  it('maps subscription price ids to their tier', () => {
    expect(tierForPrice('price_grove', CATALOG)).toBe('grove');
    expect(tierForPrice('price_canopy', CATALOG)).toBe('canopy');
  });

  it('maps the top-up price id to "topup"', () => {
    expect(tierForPrice('price_topup', CATALOG)).toBe('topup');
  });

  it('returns null for an unknown price id', () => {
    expect(tierForPrice('price_other', CATALOG)).toBeNull();
  });

  it('resolves a purchasable tier to its price id', () => {
    expect(priceForTier('grove', CATALOG)).toBe('price_grove');
    expect(priceForTier('canopy', CATALOG)).toBe('price_canopy');
  });
});
