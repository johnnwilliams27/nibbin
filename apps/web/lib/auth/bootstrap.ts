/**
 * First-sign-in account bootstrap. Pure orchestration over injected IO so it is
 * unit-tested without a live Supabase. The actual check-and-create is the
 * race-safe, advisory-locked `bootstrap_account` security-definer RPC
 * (20260610190000_bootstrap_account.sql) — calling it on every /app load and on
 * the auth callback is safe and returns the user's existing account if any.
 */
import { defaultAccountName } from './account-name';

export interface BootstrapDeps {
  /** Current authenticated user's email, or null if unauthenticated. */
  getEmail: () => Promise<string | null>;
  /** Idempotent RPC: returns the user's owner account, creating one (named) if none. */
  bootstrap: (name: string) => Promise<string>;
}

export async function ensureAccount(deps: BootstrapDeps): Promise<string> {
  const email = await deps.getEmail();
  if (!email) throw new Error('not authenticated');
  // The name is only used by the RPC when it actually creates an account;
  // for a returning user the RPC ignores it and returns the existing account.
  return deps.bootstrap(defaultAccountName(email));
}
