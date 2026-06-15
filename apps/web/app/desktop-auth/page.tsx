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
    // Preferred path: the desktop app injects the session out-of-band via a
    // webview init script (no tokens in any URL). Fallback: the URL fragment.
    const w = window as unknown as {
      __NIBBIN_HANDOFF__?: { access_token?: string; refresh_token?: string };
    };
    const injected = w.__NIBBIN_HANDOFF__;
    let tokens: { access_token: string; refresh_token: string } | null = null;
    if (injected?.access_token && injected?.refresh_token) {
      tokens = { access_token: injected.access_token, refresh_token: injected.refresh_token };
      delete w.__NIBBIN_HANDOFF__;
    } else {
      tokens = parseTokens(window.location.hash);
    }
    if (!tokens) {
      router.replace('/login');
      return;
    }
    // Strip any tokens from the address bar before doing anything else.
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
