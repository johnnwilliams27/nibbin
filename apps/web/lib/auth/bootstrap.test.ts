import { describe, it, expect, vi } from 'vitest';
import { ensureAccount } from './bootstrap';

describe('ensureAccount (delegates idempotency to the bootstrap_account RPC)', () => {
  it('ensures the profile row, then bootstraps with the default name', async () => {
    const calls: string[] = [];
    const ensureProfile = vi.fn(async () => {
      calls.push('profile');
    });
    const bootstrap = vi.fn(async (_name: string) => {
      calls.push('bootstrap');
      return 'acct_123';
    });
    const id = await ensureAccount({
      getEmail: async () => 'john.smith@example.com',
      ensureProfile,
      bootstrap,
    });
    expect(id).toBe('acct_123');
    expect(bootstrap).toHaveBeenCalledExactlyOnceWith('john.smith');
    // The users row must exist before bootstrap_account writes the membership
    // (memberships.user_id FK) — order is the contract here.
    expect(calls).toEqual(['profile', 'bootstrap']);
  });

  it('throws when there is no authenticated user', async () => {
    const ensureProfile = vi.fn(async () => {});
    const bootstrap = vi.fn(async () => 'x');
    await expect(
      ensureAccount({ getEmail: async () => null, ensureProfile, bootstrap }),
    ).rejects.toThrow(/not authenticated/i);
    expect(ensureProfile).not.toHaveBeenCalled();
    expect(bootstrap).not.toHaveBeenCalled();
  });

  it('does not bootstrap when the profile insert fails', async () => {
    const bootstrap = vi.fn(async () => 'x');
    await expect(
      ensureAccount({
        getEmail: async () => 'a@b.test',
        ensureProfile: async () => {
          throw new Error('rls said no');
        },
        bootstrap,
      }),
    ).rejects.toThrow(/rls said no/);
    expect(bootstrap).not.toHaveBeenCalled();
  });
});
