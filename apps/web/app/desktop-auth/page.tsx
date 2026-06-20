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
 * any other script (or our own async effect) can read it off `window`. The
 * access token lives on the global for as short a window as possible.
 * The refresh token is kept native-side and never injected into the webview.
 */
const HANDOFF: { access_token: string; expires_at: number } | null = (() => {
  if (typeof window === 'undefined') return null; // SSR
  const w = window as unknown as {
    __NIBBIN_HANDOFF__?: { access_token?: string; expires_at?: number };
  };
  const injected = w.__NIBBIN_HANDOFF__;
  // Clear the global immediately, whether or not it was well-formed.
  delete w.__NIBBIN_HANDOFF__;
  if (injected?.access_token) {
    return { access_token: injected.access_token, expires_at: injected.expires_at ?? 0 };
  }
  return null;
})();

export default function DesktopAuth() {
  const router = useRouter();
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    // PRIMARY: the init-script handoff (access_token + expires_at only — the
    // refresh token stays native-side; the webview session is valid for the
    // access token's remaining TTL).
    let tokens: { access_token: string; refresh_token: string } | null = null;
    if (HANDOFF) {
      tokens = { access_token: HANDOFF.access_token, refresh_token: '' };
    }
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
    <main className="da-wrap">
      <style>{`
        .da-wrap { display:flex; flex-direction:column; align-items:center; justify-content:center;
          min-height:100dvh; gap:18px; padding:24px; text-align:center;
          font-family: var(--sans, ui-sans-serif, system-ui, sans-serif);
          color: var(--ink, #23291A); background: var(--paper, #F5F6F2); }
        .da-loader { display:inline-flex; align-items:flex-end; gap:9px; height:30px; }
        .da-loader span { width:11px; height:11px; border-radius:50%;
          background: var(--moss, #5B7C2E); animation: da-rise 1.25s ease-in-out infinite; }
        .da-loader span:nth-child(2) { animation-delay:.16s; background: var(--leaf, #9CC25B); }
        .da-loader span:nth-child(3) { animation-delay:.32s; }
        .da-label { margin:0; font-size:14px; color: var(--ink-soft, #5A6248);
          animation: da-breathe 2.4s ease-in-out infinite; }
        .da-error { margin:0; font-size:14px; color:#B4452F; max-width:340px; }
        @keyframes da-rise { 0%,100% { transform:translateY(5px) scale(.7); opacity:.4 }
          50% { transform:translateY(-5px) scale(1); opacity:1 } }
        @keyframes da-breathe { 0%,100% { opacity:.55 } 50% { opacity:1 } }
        @media (prefers-reduced-motion: reduce) { .da-loader span, .da-label { animation:none } }
      `}</style>
      {err ? (
        <p className="da-error">Sign-in failed: {err}</p>
      ) : (
        <>
          <div className="da-loader" role="status" aria-label="Signing you in">
            <span />
            <span />
            <span />
          </div>
          <p className="da-label">Signing you in…</p>
        </>
      )}
    </main>
  );
}
