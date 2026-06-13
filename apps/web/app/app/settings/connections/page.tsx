import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { appSession } from '../../../../lib/auth/app-session';
import { AppShell } from '../../../../components/shell/AppShell';
import { SettingsNav } from '../../../../components/settings/SettingsNav';
import { Card, Badge } from '../../../../components/ui';
import styles from '../../../../components/settings/settings.module.css';

export const metadata: Metadata = { title: 'Connections — Settings · Nibbin' };
export const dynamic = 'force-dynamic';

type Tone = 'moss' | 'honey' | 'sky' | 'coral' | 'neutral';

const STATUS_TONE: Record<string, Tone> = {
  active: 'moss',
  pending: 'honey',
  paused: 'honey',
  error: 'coral',
  revoked: 'neutral',
};

interface ConnectionRow {
  id: string;
  provider: string;
  scopes: string[];
  status: string;
  created_at: string;
}

export default async function ConnectionsSettingsPage() {
  let session;
  try {
    session = await appSession();
  } catch {
    redirect('/login');
  }
  const { supabase, user, accountId } = session;

  // Read-only: clients can SELECT their own connections (connections_member_read)
  // but never write. Revoking is a service-role path tied to the connector
  // lifecycle, so it lives where a Nibbin asks for access — not here.
  const { data } = await supabase
    .from('connections')
    .select('id, provider, scopes, status, created_at')
    .eq('account_id', accountId)
    .neq('status', 'revoked')
    .order('created_at', { ascending: false });
  const connections = (data ?? []) as ConnectionRow[];

  return (
    <AppShell active="settings" title="Settings" email={user.email}>
      <p className={styles.eyebrow}>Account</p>
      <h1 className={styles.heading}>Settings</h1>
      <SettingsNav active="connections" />

      <div className={styles.section}>
        <Card>
          <h2 className={styles.sectionTitle}>Connected accounts</h2>
          <p className={styles.sectionHint}>
            The accounts your Nibbins can work from. Day One connections are read-only — a Nibbin
            asks for anything more later, per task, explained plainly.
          </p>

          {connections.length === 0 ? (
            <p className={styles.dangerNote}>
              Nothing connected yet. Your Nibbins ask for access when they need it — adopt one from
              the Agent Shop to get started.
            </p>
          ) : (
            <ul className={styles.connList}>
              {connections.map((conn) => (
                <li key={conn.id} className={styles.connItem}>
                  <span className={styles.connMain}>
                    <span className={styles.connProvider}>{conn.provider}</span>
                    <span className={styles.connScopes}>
                      {conn.scopes.length > 0 ? conn.scopes.join(' · ') : 'Read-only access'}
                    </span>
                  </span>
                  <Badge tone={STATUS_TONE[conn.status] ?? 'neutral'}>{conn.status}</Badge>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </AppShell>
  );
}
