import type { Metadata } from 'next';
import { requestReset } from './actions';
import styles from '../login/login.module.css';

export const metadata: Metadata = { title: 'Reset password — Nibbin' };

export default async function ForgotPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ sent?: string }>;
}) {
  const { sent } = await searchParams;

  return (
    <main className={styles.wrap}>
      <div className={styles.card}>
        <p className={styles.eyebrow}>Nibbin</p>
        {sent ? (
          <>
            <h1 className={styles.heading}>Check your email</h1>
            <p className={styles.body}>
              If an account exists for that address, a password-reset link is on its way. It works
              once and expires in an hour.
            </p>
            <a className={styles.subtleLink} href="/login">
              Back to sign in
            </a>
          </>
        ) : (
          <>
            <h1 className={styles.heading}>Reset your password</h1>
            <p className={styles.body}>Enter your email and we’ll send a link to set a new password.</p>
            <form action={requestReset} className={styles.form}>
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
              <button className={styles.primary} type="submit">
                Send reset link
              </button>
            </form>
            <a className={styles.subtleLink} href="/login">
              Back to sign in
            </a>
          </>
        )}
      </div>
    </main>
  );
}
