'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '../../lib/supabase/client';
import { parseTokens } from '../../lib/desktop-auth/parse-tokens';

/**
 * Desktop session handoff. The Nibbin desktop app — after its native login —
 * navigates its embedded Grove webview here with the Supabase tokens in the URL
 * fragment. We set the session (which writes the SSR auth cookies in this webview)
 * and land on /app, already signed in. The fragment never reaches the server.
 */
export default function DesktopAuth() {
  const router = useRouter();
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    const tokens = parseTokens(window.location.hash);
    if (!tokens) {
      router.replace('/login');
      return;
    }
    // Strip the tokens from the address bar before doing anything else.
    history.replaceState(null, '', '/desktop-auth');
    createClient()
      .auth.setSession(tokens)
      .then(({ error }) => (error ? setErr(error.message) : router.replace('/app')))
      .catch((e: unknown) => setErr(e instanceof Error ? e.message : String(e)));
  }, [router]);

  return (
    <main style={{ padding: 24, fontFamily: 'var(--sans, sans-serif)', color: 'var(--ink, #23291a)' }}>
      {err ? `Sign-in failed: ${err}` : 'Signing you in…'}
    </main>
  );
}
