import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '../../../lib/supabase/server';
import { siteOrigin } from '../../../lib/site-url';

export async function POST(request: NextRequest) {
  // CSRF guard: a hand-rolled POST handler isn't covered by Next's Server-Action
  // origin checks, so reject cross-site sign-out attempts (red-team PR #8 P3).
  const origin = request.headers.get('origin');
  const host = request.headers.get('host');
  const fetchSite = request.headers.get('sec-fetch-site');
  const crossSite = fetchSite === 'cross-site' || (origin !== null && new URL(origin).host !== host);
  if (crossSite) {
    return new NextResponse('forbidden', { status: 403 });
  }

  const supabase = await createClient();
  await supabase.auth.signOut();
  return NextResponse.redirect(`${siteOrigin()}/login`, { status: 303 });
}
