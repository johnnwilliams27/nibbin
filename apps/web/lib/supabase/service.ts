import 'server-only';
import { createClient } from '@supabase/supabase-js';

/**
 * Service-role Supabase client — bypasses RLS. ONLY for trusted server-side
 * jobs that act outside a user session: here, the Stripe webhook writing
 * subscription state and credit grants. `import 'server-only'` + the
 * non-NEXT_PUBLIC key name keep the secret off the client. The rest of the
 * product app uses the RLS-scoped session client, never this.
 */
export function serviceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SECRET_KEY');
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}
