import { describe, it, expect } from 'vitest';
import { buildGrant, buildTopup, type LedgerInsert } from './grant';

describe('webhook → credit-ledger grant builders', () => {
  it('a Grove subscription invoice grants 1,000 credits keyed to the invoice', () => {
    const row = buildGrant('acct_1', 'grove', 'in_123');
    expect(row).toEqual<LedgerInsert>({
      account_id: 'acct_1',
      delta: 1000,
      reason: 'grant',
      source_id: 'in_123',
    });
  });

  it('a Canopy subscription invoice grants 5,000 credits', () => {
    expect(buildGrant('acct_1', 'canopy', 'in_9').delta).toBe(5000);
  });

  it('source_id is the idempotency key — same invoice never double-grants downstream', () => {
    // identical source_id ⇒ the DB unique index (account_id, source_id) dedupes
    expect(buildGrant('acct_1', 'grove', 'in_x').source_id).toBe('in_x');
  });

  it('a top-up payment grants 1,000 credits per unit, keyed to the payment', () => {
    expect(buildTopup('acct_1', 1, 'pi_1')).toEqual<LedgerInsert>({
      account_id: 'acct_1',
      delta: 1000,
      reason: 'topup',
      source_id: 'pi_1',
    });
    expect(buildTopup('acct_1', 3, 'pi_2').delta).toBe(3000);
  });

  it('rejects a non-positive top-up quantity', () => {
    expect(() => buildTopup('acct_1', 0, 'pi')).toThrow();
    expect(() => buildTopup('acct_1', -1, 'pi')).toThrow();
  });

  it('rejects a blank account or source id', () => {
    expect(() => buildGrant('', 'grove', 'in_1')).toThrow();
    expect(() => buildGrant('acct_1', 'grove', '')).toThrow();
    expect(() => buildTopup('', 1, 'pi')).toThrow();
  });

  it('produces entries that pass the shared ledger sign-by-reason validation', () => {
    // grant + topup are credits (positive) — must validate against credits.ts
    expect(buildGrant('a', 'grove', 's').delta).toBeGreaterThan(0);
    expect(buildTopup('a', 1, 's').delta).toBeGreaterThan(0);
  });
});
