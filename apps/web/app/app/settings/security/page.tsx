import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { createClient } from '../../../../lib/supabase/server';
import { AppShell } from '../../../../components/shell/AppShell';
import { SettingsNav } from '../../../../components/settings/SettingsNav';
import { Card, Button, InlineFeedback } from '../../../../components/ui';
import { changePassword, signOutEverywhere } from './actions';
import styles from '../../../../components/settings/settings.module.css';

export const metadata: Metadata = { title: 'Security — Settings · Nibbin' };
export const dynamic = 'force-dynamic';

const ERRORS: Record<string, string> = {
  short: 'Use at least 8 characters.',
  mismatch: 'Those passwords didn’t match — try again.',
  failed: 'That didn’t save — give it one more try.',
};

export default async function SecuritySettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; pw?: string }>;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const { error, pw } = await searchParams;
  const errorMessage = error ? ERRORS[error] : null;

  return (
    <AppShell active="settings" title="Settings" email={user.email}>
      <p className={styles.eyebrow}>Account</p>
      <h1 className={styles.heading}>Settings</h1>
      <SettingsNav active="security" />

      <div className={styles.section}>
        <Card>
          <h2 className={styles.sectionTitle}>Change password</h2>
          <p className={styles.sectionHint}>
            You’ll use your new password to sign in everywhere — web and the Observer.
          </p>

          {pw === 'saved' ? (
            <InlineFeedback tone="success">Password updated.</InlineFeedback>
          ) : null}
          {errorMessage ? <InlineFeedback tone="error">{errorMessage}</InlineFeedback> : null}

          <form action={changePassword} className={styles.form}>
            <div className={styles.field}>
              <label className={styles.label} htmlFor="password">
                New password
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
            </div>
            <div className={styles.field}>
              <label className={styles.label} htmlFor="confirm">
                Confirm new password
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
            </div>
            <div className={styles.actions}>
              <Button type="submit" variant="primary">
                Save new password
              </Button>
            </div>
          </form>
        </Card>

        <Card>
          <h2 className={styles.sectionTitle}>Sign out everywhere</h2>
          <p className={styles.dangerNote}>
            Ends your session on this device and everywhere else you’re signed in — handy if
            you’ve used a shared computer. You’ll need to sign in again.
          </p>
          <form action={signOutEverywhere}>
            <Button type="submit" variant="secondary">
              Sign out everywhere
            </Button>
          </form>
        </Card>
      </div>
    </AppShell>
  );
}
