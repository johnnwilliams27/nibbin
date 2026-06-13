import { NextResponse, type NextRequest } from 'next/server';
import type { EmailOtpType } from '@supabase/supabase-js';
import { createClient } from '../../../lib/supabase/server';
import { ensureAccount } from '../../../lib/auth/bootstrap';
import { upsertOwnProfile } from '../../../lib/auth/profile';
import { siteOrigin } from '../../../lib/site-url';

/**
 * Auth landing for every email link. Two shapes arrive here:
 *  - Browser-initiated magic links (signInWithOtp, PKCE): `?code=` → exchangeCodeForSession.
 *  - Admin-generated invite / sign-in links (admin.generateLink): `?token_hash=&type=`
 *    → verifyOtp. Those have no PKCE verifier and otherwise resolve via Supabase's
 *    implicit /verify flow (session in the URL hash), which a server route can't read.
 * Either path: establish the session, ensure an account (idempotent), into the grove.
 * Redirect targets are built from the pinned site origin, not request headers.
 */
const OTP_TYPES = new Set(['invite', 'magiclink', 'recovery', 'email', 'signup', 'email_change']);

export async function GET(request: NextRequest) {
  const origin = siteOrigin();
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const tokenHash = url.searchParams.get('token_hash');
  const type = url.searchParams.get('type');

  const supabase = await createClient();

  let sessionError: Error | null = null;
  if (tokenHash && type && OTP_TYPES.has(type)) {
    ({ error: sessionError } = await supabase.auth.verifyOtp({ type: type as EmailOtpType, token_hash: tokenHash }));
  } else if (code) {
    ({ error: sessionError } = await supabase.auth.exchangeCodeForSession(code));
  } else {
    return NextResponse.redirect(`${origin}/login?error=link`);
  }
  if (sessionError) {
    return NextResponse.redirect(`${origin}/login?error=link`);
  }

  try {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    await ensureAccount({
      getEmail: async () => user?.email ?? null,
      ensureProfile: async () => {
        if (user) await upsertOwnProfile(supabase, user);
      },
      bootstrap: async (name) => {
        const { data, error: rpcError } = await supabase.rpc('bootstrap_account', {
          account_name: name,
        });
        if (rpcError) throw rpcError;
        return data as string;
      },
    });
  } catch {
    return NextResponse.redirect(`${origin}/login?error=bootstrap`);
  }

  return NextResponse.redirect(`${origin}/app`);
}
