import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { appSession } from '../../../../lib/auth/app-session';
import { AppShell } from '../../../../components/shell/AppShell';
import { SettingsNav } from '../../../../components/settings/SettingsNav';
import { Card, Button, Badge, InlineFeedback } from '../../../../components/ui';
import { requestDeletion, cancelDeletion } from './actions';
import styles from '../../../../components/settings/settings.module.css';

export const metadata: Metadata = { title: 'Account — Settings · Nibbin' };
export const dynamic = 'force-dynamic';

const ERRORS: Record<string, string> = {
  confirm: 'That didn’t match your account name — nothing was changed.',
  failed: 'That didn’t go through — give it one more try.',
};

interface AccountRow {
  name: string;
  purge_after: string | null;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
}

export default async function AccountSettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; state?: string }>;
}) {
  const { error, state } = await searchParams;

  let session;
  try {
    session = await appSession();
  } catch {
    redirect('/login');
  }
  const { supabase, user, accountId } = session;

  const { data } = await supabase
    .from('accounts')
    .select('name, purge_after')
    .eq('id', accountId)
    .single<AccountRow>();
  const accountName = data?.name ?? 'your account';
  const pending = !!data?.purge_after;

  return (
    <AppShell active="settings" title="Settings" email={user.email}>
      <h1 className={styles.heading}>Settings</h1>
      <SettingsNav active="account" />

      <div className={styles.section}>
        {error && <InlineFeedback tone="error">{ERRORS[error] ?? ERRORS.failed}</InlineFeedback>}
        {state === 'cancelled' && !pending && (
          <InlineFeedback tone="success">Deletion cancelled — your account is active.</InlineFeedback>
        )}

        {pending ? (
          <Card>
            <Badge tone="coral">Scheduled for deletion</Badge>
            <h2 className={styles.sectionTitle} style={{ marginTop: 10 }}>
              Deleting on {formatDate(data!.purge_after!)}
            </h2>
            <p className={styles.dangerNote}>
              Your account and everything in it are scheduled to be permanently deleted on{' '}
              {formatDate(data!.purge_after!)}. Every connection has already been disconnected, so no
              new data is flowing. You can stop this any time before that date.
            </p>
            <form action={cancelDeletion}>
              <Button type="submit" variant="primary">
                Keep my account
              </Button>
            </form>
          </Card>
        ) : (
          <Card>
            <h2 className={styles.sectionTitle}>Delete account</h2>
            <p className={styles.sectionHint}>
              This deletes <strong>{accountName}</strong> and everything in it — your grove, your
              Nibbins, your diagnosis, and every connection. We start a 30-day countdown and
              disconnect your tools right away; you can cancel anytime within those 30 days, after
              which it’s permanent and can’t be undone.
            </p>

            <form action={requestDeletion} className={styles.form}>
              <div className={styles.field}>
                <label className={styles.label} htmlFor="confirm">
                  Type your account name to confirm
                </label>
                <input
                  className={styles.input}
                  id="confirm"
                  name="confirm"
                  type="text"
                  autoComplete="off"
                  required
                  placeholder={accountName}
                  aria-describedby="confirm-hint"
                />
                <span id="confirm-hint" className={styles.fieldHint}>
                  Enter <strong>{accountName}</strong> exactly.
                </span>
              </div>
              <div className={styles.actions}>
                <Button type="submit" variant="danger">
                  Schedule deletion
                </Button>
              </div>
            </form>
          </Card>
        )}
      </div>
    </AppShell>
  );
}
