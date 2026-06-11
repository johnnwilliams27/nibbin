import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '../../../lib/supabase/server';
import { ensureAccount } from '../../../lib/auth/bootstrap';
import { upsertOwnProfile } from '../../../lib/auth/profile';
import { siteOrigin } from '../../../lib/site-url';

/**
 * Magic-link landing: exchange the code for a session, make sure the user has an
 * account (idempotent bootstrap), and send them into the grove. Redirect targets
 * are built from the pinned site origin, not request headers.
 */
export async function GET(request: NextRequest) {
  const origin = siteOrigin();
  const code = new URL(request.url).searchParams.get('code');

  if (!code) {
    return NextResponse.redirect(`${origin}/login?error=link`);
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);
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

  return NextResponse.redirect(`${origin}/app`);
}
