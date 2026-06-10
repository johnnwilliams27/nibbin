import { describe, it, expect, vi } from 'vitest';
import { ensureAccount } from './bootstrap';

describe('ensureAccount (delegates idempotency to the bootstrap_account RPC)', () => {
  it('calls bootstrap with the default name and returns the account id', async () => {
    const bootstrap = vi.fn(async (_name: string) => 'acct_123');
    const id = await ensureAccount({
      getEmail: async () => 'john.smith@example.com',
      bootstrap,
    });
    expect(id).toBe('acct_123');
    expect(bootstrap).toHaveBeenCalledExactlyOnceWith('john.smith');
  });

  it('throws when there is no authenticated user', async () => {
    const bootstrap = vi.fn(async () => 'x');
    await expect(
      ensureAccount({ getEmail: async () => null, bootstrap }),
    ).rejects.toThrow(/not authenticated/i);
    expect(bootstrap).not.toHaveBeenCalled();
  });
});
