'use client';

/**
 * Desktop sign-in bridge. The Observer opens this page in the SYSTEM browser
 * with its PKCE `challenge` + anti-CSRF `state`. The user signs in here with
 * email + password (credentials never touch the native app); we mint a one-time
 * code via /api/auth/desktop/issue, then deep-link nibbin://auth?code=...&state=...
 * back to the app, which redeems the code for the session.
 */
import { Suspense, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { createClient } from '../../../lib/supabase/client';
import styles from '../../login/login.module.css';

function DesktopAuth() {
  const params = useSearchParams();
  const challenge = params.get('challenge') ?? '';
  const state = params.get('state') ?? '';
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  if (!challenge || !state) {
    return (
      <div className={styles.card}>
        <p className={styles.eyebrow}>Nibbin Observer</p>
        <h1 className={styles.heading}>This link looks incomplete</h1>
        <p className={styles.body}>Open the Nibbin Observer app and choose “Sign in” again to get a fresh link.</p>
      </div>
    );
  }

  if (done) {
    return (
      <div className={styles.card}>
        <p className={styles.eyebrow}>Nibbin Observer</p>
        <h1 className={styles.heading}>You’re signed in</h1>
        <p className={styles.body}>Head back to the Nibbin Observer app — it’s ready for you. You can close this tab.</p>
      </div>
    );
  }

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const form = new FormData(e.currentTarget);
    const email = String(form.get('email') ?? '').trim();
    const password = String(form.get('password') ?? '');

    const supabase = createClient();
    const { data, error: signErr } = await supabase.auth.signInWithPassword({ email, password });
    if (signErr || !data.session) {
      setError('That email and password didn’t match. Try again, or reset your password on nibbin.com.');
      setBusy(false);
      return;
    }

    const res = await fetch('/api/auth/desktop/issue', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ challenge, session: data.session }),
    });
    if (!res.ok) {
      setError('You’re signed in, but I hit a snag handing off to the app. Try once more.');
      setBusy(false);
      return;
    }
    const { code } = (await res.json()) as { code: string };
    setDone(true);
    window.location.href = `nibbin://auth?code=${encodeURIComponent(code)}&state=${encodeURIComponent(state)}`;
  }

  return (
    <div className={styles.card}>
      <p className={styles.eyebrow}>Nibbin Observer</p>
      <h1 className={styles.heading}>Sign in to connect the app</h1>
      <p className={styles.body}>Sign in here and we’ll hand you securely back to the desktop app.</p>

      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}

      <form onSubmit={onSubmit} className={styles.form}>
        <label className={styles.label} htmlFor="email">
          Email
        </label>
        <input className={styles.input} id="email" name="email" type="email" autoComplete="email" required placeholder="you@studio.com" />
        <label className={styles.label} htmlFor="password">
          Password
        </label>
        <input
          className={styles.input}
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          placeholder="Your password"
        />
        <button className={styles.primary} type="submit" disabled={busy}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
      </form>

      <a className={styles.subtleLink} href="/forgot-password">
        Forgot your password?
      </a>
    </div>
  );
}

export default function DesktopAuthPage() {
  return (
    <main className={styles.wrap}>
      <Suspense fallback={<div className={styles.card} />}>
        <DesktopAuth />
      </Suspense>
    </main>
  );
}
