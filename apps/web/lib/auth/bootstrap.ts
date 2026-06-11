/**
 * First-sign-in account bootstrap. Pure orchestration over injected IO so it is
 * unit-tested without a live Supabase. The actual check-and-create is the
 * race-safe, advisory-locked `bootstrap_account` security-definer RPC
 * (20260610190000_bootstrap_account.sql) — calling it on every /app load and on
 * the auth callback is safe and returns the user's existing account if any.
 *
 * `ensureProfile` runs first: the public.users profile row must exist before
 * bootstrap_account can write the owner membership (memberships.user_id FK).
 * Nothing else creates that row — auth.users alone is not enough (found at M2
 * when a fresh local sign-in hit the FK; masked before because the RLS suite
 * seeds public.users by hand).
 */
import { defaultAccountName } from './account-name';

export interface BootstrapDeps {
  /** Current authenticated user's email, or null if unauthenticated. */
  getEmail: () => Promise<string | null>;
  /** Idempotent self-insert of the public.users profile row (RLS-gated). */
  ensureProfile: () => Promise<void>;
  /** Idempotent RPC: returns the user's owner account, creating one (named) if none. */
  bootstrap: (name: string) => Promise<string>;
}

export async function ensureAccount(deps: BootstrapDeps): Promise<string> {
  const email = await deps.getEmail();
  if (!email) throw new Error('not authenticated');
  await deps.ensureProfile();
  // The name is only used by the RPC when it actually creates an account;
  // for a returning user the RPC ignores it and returns the existing account.
  return deps.bootstrap(defaultAccountName(email));
}
