import type { Metadata } from 'next';
import { signInStaff } from './actions';
import styles from './login.module.css';

export const metadata: Metadata = { title: 'Sign in — Nibbin admin' };

const ERRORS: Record<string, string> = {
  missing: 'Enter your email and password.',
  credentials: 'That email and password didn’t match.',
  denied: 'That account isn’t on the staff list. Access denied.',
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
        <p className={styles.eyebrow}>Nibbin · staff</p>
        <h1 className={styles.heading}>Staff sign in</h1>
        <p className={styles.body}>Sign in with your Nibbin account. Staff access only.</p>
        {errorMessage && (
          <p className={styles.error} role="alert">
            {errorMessage}
          </p>
        )}
        <form action={signInStaff} className={styles.form}>
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
            placeholder="you@nibbin.com"
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
        <a className={styles.subtleLink} href="https://nibbin.com/forgot-password">
          Forgot your password?
        </a>
      </div>
    </main>
  );
}
