import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { createClient } from '../../../../lib/supabase/server';
import { AppShell } from '../../../../components/shell/AppShell';
import { SettingsNav } from '../../../../components/settings/SettingsNav';
import { Card, Button, InlineFeedback } from '../../../../components/ui';
import { saveProfile } from './actions';
import { COMMON_TIMEZONES, COMMON_LOCALES, withCurrent } from '../../../../lib/i18n/zones';
import styles from '../../../../components/settings/settings.module.css';

export const metadata: Metadata = { title: 'Profile — Settings · Nibbin' };
export const dynamic = 'force-dynamic';

interface ProfileRow {
  name: string | null;
  tz: string | null;
  locale: string | null;
}

export default async function ProfileSettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ saved?: string; error?: string }>;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const { data: me } = await supabase
    .from('users')
    .select('name, tz, locale')
    .eq('id', user.id)
    .maybeSingle<ProfileRow>();
  const { saved, error } = await searchParams;

  return (
    <AppShell active="settings" title="Settings" email={user.email}>
      <p className={styles.eyebrow}>Account</p>
      <h1 className={styles.heading}>Settings</h1>
      <SettingsNav active="profile" />

      <div className={styles.section}>
        <Card>
          <h2 className={styles.sectionTitle}>Your profile</h2>
          <p className={styles.sectionHint}>
            This is how the grove knows you. Your email is your sign-in — change that from
            Security.
          </p>

          {saved ? <InlineFeedback tone="success">Saved — your profile is up to date.</InlineFeedback> : null}
          {error ? <InlineFeedback tone="error">That didn’t save — give it another go.</InlineFeedback> : null}

          <form action={saveProfile} className={styles.form}>
            <div className={styles.field}>
              <label className={styles.label} htmlFor="email">
                Email
              </label>
              <input className={styles.input} id="email" defaultValue={user.email ?? ''} disabled />
            </div>

            <div className={styles.field}>
              <label className={styles.label} htmlFor="name">
                Display name
              </label>
              <input
                className={styles.input}
                id="name"
                name="name"
                defaultValue={me?.name ?? ''}
                placeholder="What should we call you?"
                maxLength={120}
              />
            </div>

            <div className={styles.field}>
              <label className={styles.label} htmlFor="tz">
                Timezone
              </label>
              <select className={styles.select} id="tz" name="tz" defaultValue={me?.tz ?? ''}>
                <option value="">Not set</option>
                {withCurrent(COMMON_TIMEZONES, me?.tz ?? null).map((z) => (
                  <option key={z.value} value={z.value}>
                    {z.label}
                  </option>
                ))}
              </select>
              <span className={styles.fieldHint}>
                Keeps your grove’s timing and Field Notes lined up with your day.
              </span>
            </div>

            <div className={styles.field}>
              <label className={styles.label} htmlFor="locale">
                Locale
              </label>
              <select className={styles.select} id="locale" name="locale" defaultValue={me?.locale ?? ''}>
                <option value="">Not set</option>
                {withCurrent(COMMON_LOCALES, me?.locale ?? null).map((l) => (
                  <option key={l.value} value={l.value}>
                    {l.label}
                  </option>
                ))}
              </select>
              <span className={styles.fieldHint}>How dates, times, and numbers are formatted for you.</span>
            </div>

            <div className={styles.actions}>
              <Button type="submit" variant="primary">
                Save changes
              </Button>
            </div>
          </form>
        </Card>
      </div>
    </AppShell>
  );
}
