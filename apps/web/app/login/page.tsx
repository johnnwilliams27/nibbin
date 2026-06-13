import type { Metadata } from 'next';
import { signIn } from './actions';
import styles from './login.module.css';

export const metadata: Metadata = { title: 'Sign in — Nibbin' };

// What happened / what's safe / what to do — never blame (brand-voice).
const ERRORS: Record<string, string> = {
  missing: 'Enter your email and password.',
  credentials: 'That email and password didn’t match. Try again, or reset your password below.',
  bootstrap: "You're signed in, but I hit a snag setting up your grove. Try once more and it should settle.",
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  const errorMessage = error ? (ERRORS[error] ?? ERRORS.credentials) : null;

  return (
    <main className={styles.wrap}>
      <div className={styles.card}>
        <p className={styles.eyebrow}>Nibbin</p>
        <h1 className={styles.heading}>Welcome back</h1>
        <p className={styles.body}>Sign in to your grove.</p>

        {errorMessage && (
          <p className={styles.error} role="alert">
            {errorMessage}
          </p>
        )}

        <form action={signIn} className={styles.form}>
          <label className={styles.label} htmlFor="email">
            Email
          </label>
          <input
            className={styles.input}
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            required
            placeholder="you@studio.com"
          />
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
          <button className={styles.primary} type="submit">
            Sign in
          </button>
        </form>

        <a className={styles.subtleLink} href="/forgot-password">
          Forgot your password?
        </a>

        <p className={styles.soon}>
          New to Nibbin? Accounts are invite-only during the Founding Grove —{' '}
          <a href="/#join">join the waitlist</a>.
        </p>
      </div>
    </main>
  );
}
