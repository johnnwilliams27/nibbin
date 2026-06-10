import { describe, it, expect, vi } from 'vitest';
import { ensureAccount } from './bootstrap';

describe('ensureAccount (idempotent first-sign-in account bootstrap)', () => {
  it('returns the existing account and never creates when the user already owns one', async () => {
    const createAccount = vi.fn(async (_name: string) => 'should-not-happen');
    const id = await ensureAccount({
      getEmail: async () => 'penny@studio.co',
      getOwnedAccountId: async () => 'acct_existing',
      createAccount,
    });
    expect(id).toBe('acct_existing');
    expect(createAccount).not.toHaveBeenCalled();
  });

  it('creates an account with the default name on first sign-in', async () => {
    const createAccount = vi.fn(async (_name: string) => 'acct_new');
    const id = await ensureAccount({
      getEmail: async () => 'john.smith@example.com',
      getOwnedAccountId: async () => null,
      createAccount,
    });
    expect(id).toBe('acct_new');
    expect(createAccount).toHaveBeenCalledExactlyOnceWith('john.smith');
  });

  it('throws when there is no authenticated user', async () => {
    await expect(
      ensureAccount({
        getEmail: async () => null,
        getOwnedAccountId: async () => null,
        createAccount: async () => 'x',
      }),
    ).rejects.toThrow(/not authenticated/i);
  });
});
