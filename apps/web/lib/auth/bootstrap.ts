/**
 * First-sign-in account bootstrap (idempotent). Pure orchestration over injected
 * IO so it is unit-tested without a live Supabase; the route/page supplies
 * closures wired to the RLS-scoped server client. The actual account+membership
 * creation is the `create_account_with_owner` security-definer RPC (PR #5),
 * which also enforces the per-user owned-account cap.
 */
import { defaultAccountName } from './account-name';

export interface BootstrapDeps {
  /** Current authenticated user's email, or null if unauthenticated. */
  getEmail: () => Promise<string | null>;
  /** An account id the user already owns/belongs to, or null if none (RLS-scoped). */
  getOwnedAccountId: () => Promise<string | null>;
  /** Create an account + owner membership; returns the new account id. */
  createAccount: (name: string) => Promise<string>;
}

export async function ensureAccount(deps: BootstrapDeps): Promise<string> {
  const existing = await deps.getOwnedAccountId();
  if (existing) return existing;

  const email = await deps.getEmail();
  if (!email) throw new Error('not authenticated');

  return deps.createAccount(defaultAccountName(email));
}
