import type { Metadata } from 'next';
import { sendStaffLink } from './actions';
import styles from './login.module.css';

export const metadata: Metadata = { title: 'Sign in — Nibbin admin' };

const ERRORS: Record<string, string> = {
  email: 'Enter your staff email address.',
  send: "That didn't send. Try again in a moment.",
  link: 'That link did not work — it may have expired. Request a fresh one.',
  denied: 'That account is not on the staff list. Access denied.',
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ sent?: string; error?: string }>;
}) {
  const { sent, error } = await searchParams;
  const errorMessage = error ? (ERRORS[error] ?? ERRORS.send) : null;

  return (
    <main className={styles.wrap}>
      <div className={styles.card}>
        <p className={styles.eyebrow}>Nibbin · staff</p>
        {sent ? (
          <>
            <h1 className={styles.heading}>Check your email</h1>
            <p className={styles.body}>
              A sign-in link is on its way to <strong>{sent}</strong>. Only staff accounts can sign
              in.
            </p>
            <a className={styles.subtleLink} href="/login">
              Use a different email
            </a>
          </>
        ) : (
          <>
            <h1 className={styles.heading}>Staff sign in</h1>
            <p className={styles.body}>Enter your staff email for a magic link.</p>
            {errorMessage && (
              <p className={styles.error} role="alert">
                {errorMessage}
              </p>
            )}
            <form action={sendStaffLink} className={styles.form}>
              <label className={styles.label} htmlFor="email">
                Staff email
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
              <button className={styles.primary} type="submit">
                Send the link
              </button>
            </form>
            <p className={styles.soon}>
              Google Workspace SSO + passkeys replace magic links before launch.
            </p>
          </>
        )}
      </div>
    </main>
  );
}
