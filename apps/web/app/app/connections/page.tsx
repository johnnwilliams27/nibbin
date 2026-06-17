import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { appSession } from '../../../lib/auth/app-session';
import { AppShell } from '../../../components/shell/AppShell';
import { Card, Badge, InlineFeedback } from '../../../components/ui';
import { ProviderIcon } from '../../../components/connections/ProviderIcon';
import { CONNECTABLE_PROVIDERS, scopeSummary, isReadOnly } from '../../../lib/connections/providers';
import { beginConnectAction, disconnectAction } from './actions';
import { adoptFromShopAction } from '../shop/actions';
import styles from './connections.module.css';

export const metadata: Metadata = { title: 'Connections — Nibbin' };
export const dynamic = 'force-dynamic';

type Tone = 'moss' | 'honey' | 'sky' | 'coral' | 'neutral';
const STATUS_TONE: Record<string, Tone> = { active: 'moss', pending: 'honey', paused: 'honey', error: 'coral', revoked: 'neutral' };

export default async function ConnectionsPage({
  searchParams,
}: {
  searchParams: Promise<{ connected?: string; disconnected?: string; error?: string; needed?: string; resume?: string }>;
}) {
  let session;
  try {
    session = await appSession();
  } catch {
    redirect('/login');
  }
  const { supabase, user, accountId } = session;
  const sp = await searchParams;

  const { data } = await supabase
    .from('connections')
    .select('provider, scopes, status')
    .eq('account_id', accountId)
    .neq('status', 'revoked');
  const byProvider = new Map((data ?? []).map((c) => [c.provider as string, c]));

  return (
    <AppShell active="connections" title="Connections" email={user.email}>
      <header className={styles.header}>
        <p className={styles.eyebrow}>Connections</p>
        <h1 className={styles.title}>Accounts your Nibbins work from</h1>
      </header>

      {sp.connected && <InlineFeedback tone="success">{sp.connected} is connected.</InlineFeedback>}
      {sp.disconnected && (
        <InlineFeedback tone="success">
          {CONNECTABLE_PROVIDERS.find((p) => p.id === sp.disconnected)?.label ?? 'Account'} disconnected — its access was revoked.
        </InlineFeedback>
      )}
      {sp.error === 'expired' && <InlineFeedback tone="error">That connection link expired — try again.</InlineFeedback>}
      {sp.error === 'exchange_failed' && <InlineFeedback tone="error">Couldn't finish connecting — nothing was saved. Try again.</InlineFeedback>}
      {sp.error === 'declined' && <InlineFeedback tone="error">You declined the connection.</InlineFeedback>}
      {sp.needed && (
        <InlineFeedback tone="error">
          That Nibbin needs {sp.needed.split(',').join(' and ')} connected to finish adopting.
        </InlineFeedback>
      )}

      <div className={styles.grid}>
        {CONNECTABLE_PROVIDERS.map((p) => {
          const conn = byProvider.get(p.id);
          const resumeHere = sp.resume && sp.needed?.split(',').includes(p.id);
          return (
            <Card key={p.id} className={styles.card}>
              <div className={styles.cardTop}>
                <span className={styles.icon}><ProviderIcon provider={p.id} size={22} /></span>
                <span className={styles.name}>{p.label}</span>
                {conn && <Badge tone={STATUS_TONE[conn.status] ?? 'neutral'}>{conn.status}</Badge>}
              </div>
              {conn ? (
                <>
                  <p className={styles.access}>{scopeSummary(conn.scopes as string[] | null)}</p>
                  <p className={styles.accessNote}>
                    {isReadOnly(conn.scopes as string[] | null) ? 'Read-only access' : 'Includes actions you approve'} · revoke anytime
                  </p>
                  <form action={disconnectAction} className={styles.disconnectRow}>
                    <input type="hidden" name="provider" value={p.id} />
                    <button className={styles.disconnect} type="submit">Disconnect</button>
                  </form>
                </>
              ) : p.wired ? (
                <form action={beginConnectAction}>
                  <input type="hidden" name="provider" value={p.id} />
                  {sp.resume && <input type="hidden" name="resumeTemplate" value={sp.resume} />}
                  <input type="hidden" name="returnTo" value="/app/connections" />
                  <button className={styles.connect} type="submit">Connect {p.label}</button>
                </form>
              ) : (
                <p className={styles.soon}>Coming soon</p>
              )}
              {conn && resumeHere && (
                <form action={adoptFromShopAction}>
                  <input type="hidden" name="templateKey" value={sp.resume} />
                  <button className={styles.connect} type="submit">Finish adopting</button>
                </form>
              )}
            </Card>
          );
        })}
      </div>
    </AppShell>
  );
}
