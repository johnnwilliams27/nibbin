import 'server-only';
import { createClient } from '@supabase/supabase-js';
import { getSupabaseUrl, getSupabaseSecretKey } from './env';

/**
 * Service-role client — bypasses RLS, for staff cross-account operations.
 *
 * `import 'server-only'` makes the bundler fail the build if this is ever
 * imported into a Client Component, so the secret key cannot leak to the
 * browser. Every operation performed through this client is gated by a staff
 * identity + RBAC check in the caller and written to audit_log (§6.10).
 * No session is persisted (it is not a user session).
 */
export function adminClient() {
  return createClient(getSupabaseUrl(), getSupabaseSecretKey(), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
