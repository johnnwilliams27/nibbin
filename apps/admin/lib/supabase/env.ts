/**
 * Admin Supabase config. URL + publishable key drive the STAFF login session
 * (cookie auth). The secret key is server-only (see admin.ts) and is the
 * service-role key used for cross-account staff operations — it must never be
 * sent to the browser. Accessors are functions so a missing var throws at
 * request time, not import/build time (the CI build gate compiles without
 * secrets). Literal process.env.NEXT_PUBLIC_* references let Next inline them.
 */
export function getSupabaseUrl(): string {
  const v = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!v) throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL');
  return v;
}

export function getSupabasePublishableKey(): string {
  const v = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!v) throw new Error('Missing NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY');
  return v;
}

export function getSupabaseSecretKey(): string {
  const v = process.env.SUPABASE_SECRET_KEY;
  if (!v) throw new Error('Missing SUPABASE_SECRET_KEY (admin service-role key — server only)');
  return v;
}
