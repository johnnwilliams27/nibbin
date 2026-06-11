import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '../../../lib/supabase/server';
import { adminClient } from '../../../lib/supabase/admin';
import { siteOrigin } from '../../../lib/site-url';

/**
 * Staff magic-link landing. Exchange the code, then enforce the staff allowlist:
 * a valid Supabase session is NOT admin access — the email must be in
 * staff_users. A non-staff sign-in is immediately signed out and denied, so no
 * admin session is ever issued to a non-staff user (§6.10 separate world).
 */
export async function GET(request: NextRequest) {
  const origin = siteOrigin();
  const code = new URL(request.url).searchParams.get('code');
  if (!code) return NextResponse.redirect(`${origin}/login?error=link`);

  const supabase = await createClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) return NextResponse.redirect(`${origin}/login?error=link`);

  const {
    data: { user },
  } = await supabase.auth.getUser();

  let isStaff = false;
  if (user?.email) {
    const { data } = await adminClient()
      .from('staff_users')
      .select('id')
      .ilike('email', user.email)
      .limit(1)
      .maybeSingle();
    isStaff = Boolean(data);
  }

  if (!isStaff) {
    await supabase.auth.signOut();
    return NextResponse.redirect(`${origin}/login?error=denied`);
  }

  return NextResponse.redirect(`${origin}/accounts`);
}
