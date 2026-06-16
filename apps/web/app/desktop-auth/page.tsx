'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '../../lib/supabase/client';
import { parseTokens } from '../../lib/desktop-auth/parse-tokens';

/**
 * Desktop session handoff. The Nibbin desktop app — after its native login —
 * hands the embedded Grove webview the Supabase tokens. PRIMARY path: an
 * out-of-band webview init script sets `window.__NIBBIN_HANDOFF__` (no tokens in
 * any URL). FALLBACK path: the tokens arrive in the URL fragment. We set the
 * session (which writes the SSR auth cookies in this webview) and land on /app,
 * already signed in. The fragment never reaches the server.
 */

/**
 * Capture + DELETE the init-script handoff SYNCHRONOUSLY at module load, before
 * any other script (or our own async effect) can read it off `window`. The live
 * access+refresh tokens live on the global for as short a window as possible.
 */
const HANDOFF: { access_token: string; refresh_token: string } | null = (() => {
  if (typeof window === 'undefined') return null; // SSR
  const w = window as unknown as {
    __NIBBIN_HANDOFF__?: { access_token?: string; refresh_token?: string };
  };
  const injected = w.__NIBBIN_HANDOFF__;
  // Clear the global immediately, whether or not it was well-formed.
  delete w.__NIBBIN_HANDOFF__;
  if (injected?.access_token && injected?.refresh_token) {
    return { access_token: injected.access_token, refresh_token: injected.refresh_token };
  }
  return null;
})();

export default function DesktopAuth() {
  const router = useRouter();
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    // PRIMARY: the init-script handoff, already captured + cleared at module load.
    let tokens: { access_token: string; refresh_token: string } | null = HANDOFF;
    if (!tokens) {
      // FALLBACK: tokens in the URL fragment. Strip the hash from the address
      // bar / history FIRST, then parse — so the tokens are gone from the URL
      // before any token handling happens.
      const hash = window.location.hash;
      history.replaceState(null, '', '/desktop-auth');
      tokens = parseTokens(hash);
    }
    if (!tokens) {
      router.replace('/login');
      return;
    }
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
