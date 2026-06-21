import { redirect } from 'next/navigation';
import { appSession } from '../../../../lib/auth/app-session';
import { AppShell } from '../../../../components/shell/AppShell';
import { NibbinControls } from '../NibbinControls';
import type { ActionLevel } from '../action-level-actions';
import styles from '../nibbins.module.css';

interface Props {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ writeScopeReady?: string }>;
}

export const dynamic = 'force-dynamic';

export default async function NibbinDetailPage({ params, searchParams }: Props) {
  let session;
  try {
    session = await appSession();
  } catch {
    redirect('/login');
  }
  const { supabase, accountId, user } = session;
  const { id } = await params;
  const sp = await searchParams;

  const { data: nibbin } = await supabase
    .from('nibbins')
    .select('id, name, species, stage, status, paused_reason, action_level')
    .eq('id', id)
    .eq('account_id', accountId)
    .eq('kind', 'specialist')
    .single();

  if (!nibbin) redirect('/app/nibbins');

  const provider = sp.writeScopeReady;

  return (
    <AppShell active="nibbins" title={`${nibbin.name} — Nibbin`} email={user.email}>
      <div className={styles.pageHead}>
        <a href="/app/nibbins" className={styles.abtn} style={{ display: 'inline-block', marginBottom: 16 }}>
          ← Back to nibbins
        </a>
        {provider && (
          <div className={styles.learned} style={{ marginBottom: 16 }}>
            <div className={styles.ll}>Write scope ready</div>
            <p>
              {provider.charAt(0).toUpperCase() + provider.slice(1)} write access is connected.
              Set {nibbin.name}&rsquo;s action level below to enable sending.
            </p>
          </div>
        )}
        <h1 className={styles.h1}>{nibbin.name}</h1>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <NibbinControls
          nibbinId={nibbin.id}
          name={nibbin.name}
          status={nibbin.status as string}
          pausedReason={(nibbin.paused_reason as string | null) ?? null}
          actionLevel={((nibbin.action_level as string) ?? 'draft') as ActionLevel}
          stage={nibbin.stage as 'egg' | 'student' | 'senior' | 'grad'}
        />
      </div>
    </AppShell>
  );
}
