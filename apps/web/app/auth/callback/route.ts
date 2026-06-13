import { NextResponse, type NextRequest } from 'next/server';
import type { EmailOtpType } from '@supabase/supabase-js';
import { createClient } from '../../../lib/supabase/server';
import { ensureAccount } from '../../../lib/auth/bootstrap';
import { upsertOwnProfile } from '../../../lib/auth/profile';
import { siteOrigin } from '../../../lib/site-url';

/**
 * Auth landing for invite + password-reset links (admin.generateLink, token_hash
 * flow). verifyOtp establishes a short-lived session; we make sure the account
 * exists, then send the user to set (invite) or reset (recovery) their password.
 * Day-to-day sign-in is email + password and never passes through here.
 */
const OTP_TYPES = new Set(['invite', 'recovery', 'email', 'signup', 'email_change']);

export async function GET(request: NextRequest) {
  const origin = siteOrigin();
  const url = new URL(request.url);
  const tokenHash = url.searchParams.get('token_hash');
  const type = url.searchParams.get('type');

  if (!tokenHash || !type || !OTP_TYPES.has(type)) {
    return NextResponse.redirect(`${origin}/login?error=link`);
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.verifyOtp({ type: type as EmailOtpType, token_hash: tokenHash });
  if (error) {
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

  const mode = type === 'recovery' ? 'reset' : 'create';
  return NextResponse.redirect(`${origin}/auth/set-password?mode=${mode}`);
}
