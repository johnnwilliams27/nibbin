import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { appSession } from '../../../lib/auth/app-session';
import { AppShell } from '../../../components/shell/AppShell';
import { Card, Badge, InlineFeedback } from '../../../components/ui';
import { ConnectorLogo } from '../../../components/help/ConnectorLogo';
import { CONNECTABLE_PROVIDERS, scopeSummary, isReadOnly } from '../../../lib/connections/providers';
import { beginConnectAction, disconnectAction } from './actions';
import { AdoptButton } from '../../../components/adopt/AdoptButton';
import { adoptFromShopOutcome } from '../shop/actions';
import { ConnectorDirectory } from '../../../components/help/ConnectorDirectory';
import { CONNECTORS } from '../../../lib/connections/catalog';
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

  // Short list = wired connectables + any provider you actually have a
  // (non-revoked) connection for, so active accounts always populate here.
  // Coming-soon providers live only in the directory below.
  const catalogById = new Map(CONNECTORS.map((c) => [c.id, c]));
  const providerMeta = (id: string): { label: string; domain: string | null } => {
    const fromList = CONNECTABLE_PROVIDERS.find((p) => p.id === id);
    const fromCatalog = catalogById.get(id);
    return {
      label: fromList?.label ?? fromCatalog?.name ?? id,
      domain: fromList?.domain ?? fromCatalog?.domain ?? null,
    };
  };
  const wiredIds = CONNECTABLE_PROVIDERS.filter((p) => p.wired).map((p) => p.id);
  const shortListIds = Array.from(
    new Set([...wiredIds, ...(data ?? []).map((c) => c.provider as string)]),
  );
  // Only genuinely-active connections are marked "Connected" in the directory.
  const activeConnectedIds = (data ?? [])
    .filter((c) => c.status === 'active')
    .map((c) => c.provider as string);

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
        {shortListIds.map((id) => {
          const meta = providerMeta(id);
          const conn = byProvider.get(id);
          const wired = CONNECTABLE_PROVIDERS.find((p) => p.id === id)?.wired ?? false;
          const resumeHere = sp.resume && sp.needed?.split(',').includes(id);
          return (
            <Card key={id} className={styles.card}>
              <div className={styles.cardTop}>
                <span className={styles.icon}><ConnectorLogo name={meta.label} domain={meta.domain} /></span>
                <span className={styles.name}>{meta.label}</span>
                {conn && <Badge tone={STATUS_TONE[conn.status] ?? 'neutral'}>{conn.status}</Badge>}
              </div>
              {conn ? (
                <>
                  <p className={styles.access}>{scopeSummary(conn.scopes as string[] | null)}</p>
                  <p className={styles.accessNote}>
                    {isReadOnly(conn.scopes as string[] | null) ? 'Read-only access' : 'Includes actions you approve'} · revoke anytime
                  </p>
                  <form action={disconnectAction} className={styles.disconnectRow}>
                    <input type="hidden" name="provider" value={id} />
                    <button className={styles.disconnect} type="submit">Disconnect</button>
                  </form>
                </>
              ) : wired ? (
                <form action={beginConnectAction}>
                  <input type="hidden" name="provider" value={id} />
                  {sp.resume && <input type="hidden" name="resumeTemplate" value={sp.resume} />}
                  <input type="hidden" name="returnTo" value="/app/connections" />
                  <button className={styles.connect} type="submit">Connect {meta.label}</button>
                  {id === 'gmail' && (
                    <label className={styles.accessNote} style={{ display: 'block', marginTop: 8 }}>
                      <input type="checkbox" name="sweepConsent" />{' '}
                      Also learn my style from my mail — a one-time read of about my last 12 months of
                      sent &amp; inbox mail. My sent messages are processed by the model to learn my
                      voice; my inbox is reduced to subjects and previews. Only short derived notes are
                      kept. I can turn this off in Data &amp; Privacy.
                    </label>
                  )}
                </form>
              ) : (
                <p className={styles.soon}>Coming soon</p>
              )}
              {conn && resumeHere && sp.resume && (
                <AdoptButton
                  action={adoptFromShopOutcome}
                  templateKey={sp.resume}
                  label="Finish adopting"
                />
              )}
            </Card>
          );
        })}
      </div>

      <ConnectorDirectory connectors={CONNECTORS} heading="Browse all connectors" connectedIds={activeConnectedIds} />
    </AppShell>
  );
}
