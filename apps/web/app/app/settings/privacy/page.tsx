import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { appSession } from '../../../../lib/auth/app-session';
import { AppShell } from '../../../../components/shell/AppShell';
import { SettingsNav } from '../../../../components/settings/SettingsNav';
import { Card, Button, Badge, InlineFeedback, Select } from '../../../../components/ui';
import { setContribution, setNotificationPrefs } from './actions';
import { HOUR_OPTIONS } from '../../../../lib/privacy/notifications';
import { connectionSummary, deletionState, type ConnectionRow } from '../../../../lib/privacy/panel';
import styles from '../../../../components/settings/settings.module.css';

export const metadata: Metadata = { title: 'Data & Privacy — Settings · Nibbin' };
export const dynamic = 'force-dynamic';

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
}

export default async function PrivacySettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ state?: string; error?: string }>;
}) {
  const { state, error } = await searchParams;

  let session;
  try {
    session = await appSession();
  } catch {
    redirect('/login');
  }
  const { supabase, user, accountId } = session;

  const { data: acct } = await supabase
    .from('accounts')
    .select('purge_after, model_contribution_enabled')
    .eq('id', accountId)
    .single<{ purge_after: string | null; model_contribution_enabled: boolean }>();
  const del = deletionState(acct?.purge_after);
  const contributing = acct?.model_contribution_enabled ?? true;

  const { data: conns } = await supabase
    .from('connections')
    .select('provider, scopes, status')
    .eq('account_id', accountId)
    .neq('status', 'revoked');
  const summary = connectionSummary((conns ?? []) as ConnectionRow[]);

  const { data: drip } = await supabase
    .from('drip_arcs')
    .select('email_enabled, quiet_start, quiet_end')
    .eq('account_id', accountId)
    .maybeSingle<{ email_enabled: boolean; quiet_start: number; quiet_end: number }>();
  const emailEnabled = drip?.email_enabled ?? true;
  const quietStart = drip?.quiet_start ?? 21;
  const quietEnd = drip?.quiet_end ?? 9;

  return (
    <AppShell active="settings" title="Settings" email={user.email}>
      <p className={styles.eyebrow}>Account</p>
      <h1 className={styles.heading}>Settings</h1>
      <SettingsNav active="privacy" />

      <div className={styles.section}>
        <Card>
          <h2 className={styles.sectionTitle}>What the Field Study sees</h2>
          <p className={styles.sectionHint}>
            The two-week Field Study runs on your device. Banking, health, and other sensitive
            categories are excluded by default, secure fields like passwords can&apos;t be captured,
            and you can exclude any app or site or pause everything with one hotkey.
          </p>
          <p className={styles.dangerNote}>
            Only the redacted synthesis packet ever leaves your device, and only when you choose to
            build your diagnosis. Your screen recordings never do — by architecture, not policy.
          </p>
        </Card>

        <Card>
          <h2 className={styles.sectionTitle}>How long things are kept</h2>
          <ul className={styles.connList}>
            <li className={styles.connItem}>
              <div className={styles.connMain}>
                <span className={styles.connProvider}>Raw Field Study data</span>
                <span className={styles.connScopes}>On your device, until your diagnosis is built — 14 days max.</span>
              </div>
            </li>
            <li className={styles.connItem}>
              <div className={styles.connMain}>
                <span className={styles.connProvider}>Agent run logs</span>
                <span className={styles.connScopes}>90 days by default; shorten or wipe them anytime.</span>
              </div>
            </li>
            <li className={styles.connItem}>
              <div className={styles.connMain}>
                <span className={styles.connProvider}>Connection tokens</span>
                <span className={styles.connScopes}>Held in an encrypted vault while connected; one-click revoke.</span>
              </div>
            </li>
            <li className={styles.connItem}>
              <div className={styles.connMain}>
                <span className={styles.connProvider}>Account data</span>
                <span className={styles.connScopes}>Life of the account, plus 30 days after verified deletion.</span>
              </div>
            </li>
          </ul>
        </Card>

        <Card>
          <h2 className={styles.sectionTitle}>Connections</h2>
          <p className={styles.sectionHint}>
            {summary.total === 0
              ? 'No tools are connected yet. Connections start read-only — a Nibbin asks for write access separately, in plain words.'
              : `You have ${summary.total} connected ${summary.total === 1 ? 'tool' : 'tools'}. Connections start read-only; write access is granted per Nibbin, by you.`}
          </p>
          {summary.total > 0 && (
            <ul className={styles.connList}>
              {summary.items.map((c) => (
                <li key={c.provider} className={styles.connItem}>
                  <div className={styles.connMain}>
                    <span className={styles.connProvider}>{c.provider}</span>
                    <span className={styles.connScopes}>{c.access}</span>
                  </div>
                  <Badge tone={c.status === 'active' ? 'moss' : 'neutral'}>{c.status}</Badge>
                </li>
              ))}
            </ul>
          )}
          <div className={styles.actions}>
            <Link href="/app/connections">
              <Button variant="secondary">Manage connections</Button>
            </Link>
          </div>
        </Card>

        <Card>
          <h2 className={styles.sectionTitle}>Notifications</h2>
          <p className={styles.sectionHint}>
            During your field study, your grove sends a few gentle email nudges — Field Notes,
            milestones, your map when it’s ready. Turn them off or set quiet hours here. (Text and
            chat channels arrive when your Nibbins start doing real work.)
          </p>
          {state === 'notify_saved' && (
            <InlineFeedback tone="success">Saved — your notification choices are recorded.</InlineFeedback>
          )}
          {error === 'notify' && (
            <InlineFeedback tone="error">That didn’t save — give it another go.</InlineFeedback>
          )}
          <form action={setNotificationPrefs} className={styles.form}>
            <div className={styles.field}>
              <label className={styles.label} htmlFor="email_enabled">
                Companion emails
              </label>
              <label className={styles.fieldHint}>
                <input
                  id="email_enabled"
                  name="email_enabled"
                  type="checkbox"
                  defaultChecked={emailEnabled}
                />{' '}
                Email me the field-study nudges
              </label>
            </div>
            <div className={styles.field}>
              <label className={styles.label} htmlFor="quiet_start">
                Quiet hours start
              </label>
              <Select id="quiet_start" name="quiet_start" defaultValue={String(quietStart)} options={HOUR_OPTIONS} />
            </div>
            <div className={styles.field}>
              <label className={styles.label} htmlFor="quiet_end">
                Quiet hours end
              </label>
              <Select id="quiet_end" name="quiet_end" defaultValue={String(quietEnd)} options={HOUR_OPTIONS} />
              <span className={styles.fieldHint}>No emails are sent during your quiet hours.</span>
            </div>
            <div className={styles.actions}>
              <Button type="submit" variant="primary">
                Save notifications
              </Button>
            </div>
          </form>
        </Card>

        <Card>
          <h2 className={styles.sectionTitle}>Model improvement</h2>
          <p className={styles.sectionHint}>
            Nibbin never trains on your content. When this is on, Nibbin learns from anonymized,
            aggregate signals about how its capabilities and models perform — never your data,
            never your content, and never sold. You can turn it off anytime.
          </p>
          {state === 'saved' && (
            <InlineFeedback tone="success">Saved — your choice is recorded.</InlineFeedback>
          )}
          {error === 'contribution' && (
            <InlineFeedback tone="error">That didn’t save — give it another go.</InlineFeedback>
          )}
          <div className={styles.actions}>
            <Badge tone={contributing ? 'moss' : 'neutral'}>{contributing ? 'On' : 'Off'}</Badge>
            <form action={setContribution}>
              <input type="hidden" name="enabled" value={contributing ? 'false' : 'true'} />
              <Button type="submit" variant="secondary">
                {contributing ? 'Turn off' : 'Turn on'}
              </Button>
            </form>
          </div>
        </Card>

        <Card>
          <h2 className={styles.sectionTitle}>Your data</h2>
          {del.pending && del.date ? (
            <>
              <Badge tone="coral">Scheduled for deletion</Badge>
              <p className={styles.dangerNote} style={{ marginTop: 10 }}>
                Your account is scheduled to be permanently deleted on {formatDate(del.date)}. Every
                connection has already been disconnected. You can stop this from the Account tab.
              </p>
            </>
          ) : (
            <p className={styles.sectionHint}>
              You can delete your account and everything in it — your grove, your Nibbins, your
              diagnosis, and every connection — from the Account tab. On the desktop app, “Delete
              everything” wipes the captured study data on this machine and verifies it&apos;s gone.
            </p>
          )}
          <div className={styles.actions}>
            <Link href="/app/settings/account">
              <Button variant="secondary">Go to Account</Button>
            </Link>
          </div>
        </Card>
      </div>
    </AppShell>
  );
}
