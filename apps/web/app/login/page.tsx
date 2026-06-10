import type { Metadata } from 'next';
import { sendMagicLink } from './actions';
import styles from './login.module.css';

export const metadata: Metadata = { title: 'Sign in — Nibbin' };

// What happened / what's safe / what to do — never blame (brand-voice).
const ERRORS: Record<string, string> = {
  email: 'I need an email address to send the link to.',
  send: "That didn't send. Nothing's changed — give it another try in a moment.",
  link: "That link didn't work — it may have expired. Let's get you a fresh one.",
  bootstrap: "You're signed in, but I hit a snag setting up your grove. Try once more and it should settle.",
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
        <p className={styles.eyebrow}>Nibbin</p>

        {sent ? (
          <>
            <h1 className={styles.heading}>Check your email</h1>
            <p className={styles.body}>
              I sent a magic link to <strong>{sent}</strong>. Click it and you&apos;re in — no
              password to remember.
            </p>
            <a className={styles.subtleLink} href="/login">
              Use a different email
            </a>
          </>
        ) : (
          <>
            <h1 className={styles.heading}>Come on in</h1>
            <p className={styles.body}>
              Enter your email and I&apos;ll send you a magic link to sign in.
            </p>

            {errorMessage && (
              <p className={styles.error} role="alert">
                {errorMessage}
              </p>
            )}

            <form action={sendMagicLink} className={styles.form}>
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
                Send the link
              </button>
            </form>

            <div className={styles.providers}>
              <button className={styles.provider} type="button" disabled aria-disabled="true">
                Continue with Google
              </button>
              <button className={styles.provider} type="button" disabled aria-disabled="true">
                Continue with Apple
              </button>
              <p className={styles.soon}>Google and Apple sign-in are coming soon.</p>
            </div>
          </>
        )}
      </div>
    </main>
  );
}
