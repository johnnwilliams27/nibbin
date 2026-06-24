/**
 * Pre-flight credit gate (feat/credit-metering-usage). The soft-gate's STARTING
 * check: positive balance admits, non-positive refuses, unreadable fails CLOSED.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Controllable service client: from('credit_ledger').select('delta').eq(...) →
// { data, error }. The terminal `.eq` resolves the promise.
let nextResult: { data: unknown; error: unknown } = { data: [], error: null };
const eq = vi.fn(async () => nextResult);
const select = vi.fn(() => ({ eq }));
const from = vi.fn(() => ({ select }));
vi.mock('../supabase/service', () => ({ serviceClient: () => ({ from }) }));

import { readBalance, canStartNewWork } from './gate';

describe('readBalance — sums account-scoped ledger deltas', () => {
  beforeEach(() => {
    from.mockClear();
    select.mockClear();
    eq.mockClear();
  });

  it('sums the deltas for the account', async () => {
    nextResult = { data: [{ delta: 100 }, { delta: -3 }, { delta: -1 }], error: null };
    expect(await readBalance('acct-1')).toBe(96);
    expect(from).toHaveBeenCalledWith('credit_ledger');
    expect(eq).toHaveBeenCalledWith('account_id', 'acct-1');
  });

  it('a negative net (usage drove it under zero) reads negative — honest', async () => {
    nextResult = { data: [{ delta: 100 }, { delta: -150 }], error: null };
    expect(await readBalance('acct-1')).toBe(-50);
  });

  it('returns null on a read error (caller fails closed)', async () => {
    nextResult = { data: null, error: { message: 'db down' } };
    expect(await readBalance('acct-1')).toBeNull();
  });
});

describe('canStartNewWork — gates STARTING on a positive balance', () => {
  beforeEach(() => {
    from.mockClear();
  });

  it('admits a positive balance', async () => {
    nextResult = { data: [{ delta: 5 }], error: null };
    expect(await canStartNewWork('acct-1')).toBe(true);
  });

  it('refuses a zero balance', async () => {
    nextResult = { data: [{ delta: 1 }, { delta: -1 }], error: null };
    expect(await canStartNewWork('acct-1')).toBe(false);
  });

  it('refuses a negative balance (already overdrawn by usage)', async () => {
    nextResult = { data: [{ delta: -10 }], error: null };
    expect(await canStartNewWork('acct-1')).toBe(false);
  });

  it('fails CLOSED on an unreadable ledger (never spend on an unprovable balance)', async () => {
    nextResult = { data: null, error: { message: 'db down' } };
    expect(await canStartNewWork('acct-1')).toBe(false);
  });
});
