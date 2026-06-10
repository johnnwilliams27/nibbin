import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '../../../lib/supabase/server';
import { ensureAccount } from '../../../lib/auth/bootstrap';

/**
 * Magic-link landing: exchange the code for a session, then make sure the user
 * has an account (idempotent bootstrap), and send them into the grove.
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get('code');

  if (!code) {
    return NextResponse.redirect(`${origin}/login?error=link`);
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) {
    return NextResponse.redirect(`${origin}/login?error=link`);
  }

  try {
    await ensureAccount({
      getEmail: async () => (await supabase.auth.getUser()).data.user?.email ?? null,
      getOwnedAccountId: async () => {
        const { data } = await supabase
          .from('memberships')
          .select('account_id')
          .eq('role', 'owner')
          .limit(1);
        return data?.[0]?.account_id ?? null;
      },
      createAccount: async (name) => {
        const { data, error: rpcError } = await supabase.rpc('create_account_with_owner', {
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
