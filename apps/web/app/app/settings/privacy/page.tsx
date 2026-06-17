import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { appSession } from '../../../../lib/auth/app-session';
import { AppShell } from '../../../../components/shell/AppShell';
import { SettingsNav } from '../../../../components/settings/SettingsNav';
import { Card, Button, Badge } from '../../../../components/ui';
import { connectionSummary, deletionState, type ConnectionRow } from '../../../../lib/privacy/panel';
import styles from '../../../../components/settings/settings.module.css';

export const metadata: Metadata = { title: 'Data & Privacy — Settings · Nibbin' };
export const dynamic = 'force-dynamic';

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
}

export default async function PrivacySettingsPage() {
  let session;
  try {
    session = await appSession();
  } catch {
    redirect('/login');
  }
  const { supabase, user, accountId } = session;

  const { data: acct } = await supabase
    .from('accounts')
    .select('purge_after')
    .eq('id', accountId)
    .single<{ purge_after: string | null }>();
  const del = deletionState(acct?.purge_after);

  const { data: conns } = await supabase
    .from('connections')
    .select('provider, scopes, status')
    .eq('account_id', accountId)
    .neq('status', 'revoked');
  const summary = connectionSummary((conns ?? []) as ConnectionRow[]);

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
          <h2 className={styles.sectionTitle}>Model improvement</h2>
          <p className={styles.sectionHint}>
            We never sell your data, and we don&apos;t share it for advertising. How your data helps
            improve Nibbin — and your control over it — is covered in our privacy policy. The
            in-app opt-out control is on its way as we finish building this panel.
          </p>
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
