import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { createClient } from '../../../lib/supabase/server';
import { setPassword } from './actions';
import styles from '../../login/login.module.css';

export const metadata: Metadata = { title: 'Set your password — Nibbin' };

const ERRORS: Record<string, string> = {
  short: 'Use at least 8 characters.',
  mismatch: 'Those passwords didn’t match — try again.',
  failed: 'That didn’t save — give it one more try.',
};

export default async function SetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; mode?: string }>;
}) {
  const { error, mode } = await searchParams;

  // The invite/recovery link established a session via /auth/callback; without
  // one there's nothing to set a password against.
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const creating = mode !== 'reset';
  const errorMessage = error ? ERRORS[error] : null;

  return (
    <main className={styles.wrap}>
      <div className={styles.card}>
        <p className={styles.eyebrow}>Nibbin</p>
        <h1 className={styles.heading}>{creating ? 'Create your password' : 'Choose a new password'}</h1>
        <p className={styles.body}>
          {creating ? 'Set a password for ' : 'Set a new password for '}
          <strong>{user.email}</strong>. You’ll use it to sign in everywhere.
        </p>

        {errorMessage && (
          <p className={styles.error} role="alert">
            {errorMessage}
          </p>
        )}

        <form action={setPassword} className={styles.form}>
          <label className={styles.label} htmlFor="password">
            Password
          </label>
          <input
            className={styles.input}
            id="password"
            name="password"
            type="password"
            autoComplete="new-password"
            required
            minLength={8}
            placeholder="At least 8 characters"
          />
          <label className={styles.label} htmlFor="confirm">
            Confirm password
          </label>
          <input
            className={styles.input}
            id="confirm"
            name="confirm"
            type="password"
            autoComplete="new-password"
            required
            minLength={8}
            placeholder="Re-enter your password"
          />
          <button className={styles.primary} type="submit">
            {creating ? 'Create password & continue' : 'Save new password'}
          </button>
        </form>
      </div>
    </main>
  );
}
