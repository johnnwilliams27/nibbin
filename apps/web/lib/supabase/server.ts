import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { getSupabaseUrl, getSupabasePublishableKey } from './env';

/**
 * Server Supabase client bound to the request cookie store. Reads are RLS-scoped
 * to the signed-in user — this is what makes the /app dashboard a real
 * demonstration of membership-gated access. Cookie writes during RSC render are
 * swallowed (Next forbids them there); the middleware refreshes the session.
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
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // called from a Server Component render — middleware handles refresh
        }
      },
    },
  });
}
