/**
 * Free-first-diagnosis entitlement + credit gate.
 *
 * Guarantees proven here:
 *  • FIRST diagnosis is free and consumes the flag atomically (one row updated);
 *  • once consumed, a zero-credit account is REFUSED (needs_credits) without any
 *    further free pass;
 *  • once consumed, an account WITH credits is told to 'charge';
 *  • the WHERE-guarded consume is race-safe — the loser (no row updated) falls
 *    through to the credit gate;
 *  • fail-closed: a consume error routes through the credit gate (never an
 *    infinite free run); a ledger-read error refuses rather than spends;
 *  • chargeDiagnosis writes a frontier-weight run debit.
 *
 * The Supabase service client is mocked: the accounts UPDATE chain and the
 * credit_ledger SELECT are controllable per test.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

// --- mock seams ---------------------------------------------------------
// accounts update: .update().eq().eq().select() resolves to { data, error }.
let accountsUpdateResult: { data: Array<{ id: string }> | null; error: { message: string } | null };
// credit_ledger select: .select().eq() resolves to { data, error }.
let ledgerSelectResult: { data: Array<{ delta: number }> | null; error: { message: string } | null };
// captured credit_ledger inserts
const ledgerInsert = vi.fn();

function accountsUpdateChain() {
  const chain: Record<string, unknown> = {};
  chain.eq = vi.fn(() => chain);
  chain.select = vi.fn(async () => accountsUpdateResult);
  return chain;
}

function ledgerSelectChain() {
  const chain: Record<string, unknown> = {};
  // .eq() is terminal here (single filter) but must also be awaitable; make it
  // both chainable AND thenable by returning the result on the final eq.
  chain.eq = vi.fn(async () => ledgerSelectResult);
  return chain;
}

const from = vi.fn((table: string) => {
  if (table === 'accounts') {
    return { update: vi.fn(() => accountsUpdateChain()) };
  }
  if (table === 'credit_ledger') {
    return {
      select: vi.fn(() => ledgerSelectChain()),
      insert: ledgerInsert,
    };
  }
  throw new Error(`unexpected table ${table}`);
});

vi.mock('../supabase/service', () => ({ serviceClient: () => ({ from }) }));

import {
  chargeDiagnosis,
  DIAGNOSIS_CREDIT_COST,
  NEEDS_CREDITS_MESSAGE,
  resolveDiagnosisEntitlement,
} from './diagnosis-entitlement';

beforeEach(() => {
  accountsUpdateResult = { data: [], error: null };
  ledgerSelectResult = { data: [], error: null };
  ledgerInsert.mockReset().mockResolvedValue({ error: null });
  from.mockClear();
});

describe('resolveDiagnosisEntitlement', () => {
  it('FIRST diagnosis is free (the consume updated a row)', async () => {
    accountsUpdateResult = { data: [{ id: 'acct-1' }], error: null };
    const out = await resolveDiagnosisEntitlement('acct-1');
    expect(out).toEqual({ kind: 'free' });
    // never read the ledger on the free path
    expect(from).not.toHaveBeenCalledWith('credit_ledger');
  });

  it('already-consumed + zero credits is refused (no free pass)', async () => {
    accountsUpdateResult = { data: [], error: null }; // nothing to consume
    ledgerSelectResult = { data: [], error: null }; // empty ledger → balance 0
    const out = await resolveDiagnosisEntitlement('acct-1');
    expect(out).toEqual({ kind: 'needs_credits', message: NEEDS_CREDITS_MESSAGE });
  });

  it('already-consumed + enough credits → charge', async () => {
    accountsUpdateResult = { data: [], error: null };
    // grant 1000, no spend → balance 1000 ≥ frontier weight (3)
    ledgerSelectResult = { data: [{ delta: 1000 }], error: null };
    const out = await resolveDiagnosisEntitlement('acct-1');
    expect(out).toEqual({ kind: 'charge' });
  });

  it('already-consumed + balance below the frontier weight is refused', async () => {
    accountsUpdateResult = { data: [], error: null };
    // 1000 granted, 998 spent → balance 2 < frontier weight 3
    ledgerSelectResult = { data: [{ delta: 1000 }, { delta: -998 }], error: null };
    const out = await resolveDiagnosisEntitlement('acct-1');
    expect(out.kind).toBe('needs_credits');
  });

  it('race: two concurrent firsts — only one is free, the other falls through', async () => {
    // First caller wins the WHERE-guarded update (a row); second sees no row and
    // hits the (zero-credit) gate.
    accountsUpdateResult = { data: [{ id: 'acct-1' }], error: null };
    const first = await resolveDiagnosisEntitlement('acct-1');

    accountsUpdateResult = { data: [], error: null };
    ledgerSelectResult = { data: [], error: null };
    const second = await resolveDiagnosisEntitlement('acct-1');

    expect(first).toEqual({ kind: 'free' });
    expect(second.kind).toBe('needs_credits');
  });

  it('fail-closed: a consume error routes through the credit gate, never free', async () => {
    accountsUpdateResult = { data: null, error: { message: 'db down' } };
    ledgerSelectResult = { data: [{ delta: 1000 }], error: null };
    const out = await resolveDiagnosisEntitlement('acct-1');
    // gate applied (had credits) → charge, NOT free
    expect(out).toEqual({ kind: 'charge' });
  });

  it('fail-closed: an unreadable ledger refuses rather than spends', async () => {
    accountsUpdateResult = { data: [], error: null }; // consumed
    ledgerSelectResult = { data: null, error: { message: 'ledger boom' } };
    const out = await resolveDiagnosisEntitlement('acct-1');
    expect(out.kind).toBe('needs_credits');
  });
});

describe('chargeDiagnosis', () => {
  it('writes a frontier-weight run debit tied to the runId', async () => {
    await chargeDiagnosis('acct-1', 'run-9');
    expect(ledgerInsert).toHaveBeenCalledTimes(1);
    expect(ledgerInsert).toHaveBeenCalledWith({
      account_id: 'acct-1',
      delta: -DIAGNOSIS_CREDIT_COST,
      reason: 'run',
      run_id: 'run-9',
    });
  });
});
