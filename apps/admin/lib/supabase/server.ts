import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { getSupabaseUrl, getSupabasePublishableKey } from './env';

/**
 * Staff-session client (publishable key, cookie-bound). This authenticates the
 * STAFF member themselves — it carries no elevated rights. Cross-account data
 * access uses the service-role client (admin.ts), never this one.
 */
export async function createClient() {
  const cookieStore = await cookies();
  return createServerClient(getSupabaseUrl(), getSupabasePublishableKey(), {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) cookieStore.set(name, value, options);
        } catch {
          // RSC render — middleware refreshes
        }
      },
    },
  });
}
