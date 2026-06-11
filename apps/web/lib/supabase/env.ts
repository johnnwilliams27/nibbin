/**
 * Public Supabase config. Both vars are NEXT_PUBLIC (safe in the browser): the
 * publishable key is the client-facing key and carries no elevated rights —
 * every read is still gated by RLS on the user's session. The sb_secret_* key
 * is read only by the server-only service client (lib/supabase/service.ts) for
 * the Stripe webhook — never here, and never on the client.
 *
 * Accessors are functions (not module constants) so a missing var throws at
 * request time, never at import/build time — the CI `build` gate compiles
 * without Supabase secrets. The literal `process.env.NEXT_PUBLIC_*` references
 * are what let Next inline the values into the client bundle.
 */
export function getSupabaseUrl(): string {
  const v = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!v) throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL (see apps/web/.env.local / GitHub env secrets)');
  return v;
}

export function getSupabasePublishableKey(): string {
  const v = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!v) throw new Error('Missing NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY (see apps/web/.env.local / GitHub env secrets)');
  return v;
}
