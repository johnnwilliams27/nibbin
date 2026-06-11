import { createServerClient } from '@supabase/ssr';
import { createClient as createServiceClient } from '@supabase/supabase-js';
import { NextResponse, type NextRequest } from 'next/server';
import { getSupabaseUrl, getSupabasePublishableKey, getSupabaseSecretKey } from './env';

/**
 * Refresh the staff session and gate routes: unauthenticated users can only
 * reach /login and /auth/*. Staff-allowlist enforcement (not just "signed in")
 * happens at the callback and in getStaff() on every protected page — a
 * signed-in non-staff user is rejected there.
 */
export async function updateSession(request: NextRequest): Promise<NextResponse> {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(getSupabaseUrl(), getSupabasePublishableKey(), {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        for (const { name, value } of cookiesToSet) request.cookies.set(name, value);
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) response.cookies.set(name, value, options);
      },
    },
  });

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const path = request.nextUrl.pathname;
  const isPublic = path === '/login' || path.startsWith('/auth/');
  if (!user && !isPublic) {
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    return NextResponse.redirect(url);
  }

  // Defense in depth (red-team P2): a valid *product* session must not reach the
  // admin perimeter. getStaff() gates every page/action, but enforce the staff
  // allowlist here too so a forgotten getStaff() on a future route can't leak.
  if (user && !isPublic) {
    const svc = createServiceClient(getSupabaseUrl(), getSupabaseSecretKey(), {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data } = await svc.rpc('staff_identity_for_email', { p_email: user.email });
    if (!Array.isArray(data) || data.length === 0) {
      const url = request.nextUrl.clone();
      url.pathname = '/login';
      url.search = '?error=denied';
      return NextResponse.redirect(url);
    }
  }

  if (user && path === '/login') {
    const url = request.nextUrl.clone();
    url.pathname = '/accounts';
    return NextResponse.redirect(url);
  }

  return response;
}
