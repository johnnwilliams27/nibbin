import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createClient } from '../../../../lib/supabase/server';
import { ensureAccount } from '../../../../lib/auth/bootstrap';
import { upsertOwnProfile } from '../../../../lib/auth/profile';
import { AppShell } from '../../../../components/shell/AppShell';
import { Badge } from '../../../../components/ui';
import type { DiagnosisMap } from '../../../../lib/diagnosis/types';
import { DiagnosisReveal } from '../DiagnosisReveal';
import styles from '../diagnosis.module.css';

export const metadata: Metadata = { title: 'Your diagnosis — Nibbin' };
export const dynamic = 'force-dynamic';

type DiagnosisKind = 'full_study' | 'quick_scan';

interface DiagnosisDetailRow {
  map: DiagnosisMap;
  letter: string | null;
  kind: DiagnosisKind | null;
  label: string | null;
}

export default async function DiagnosisDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const accountId = await ensureAccount({
    getEmail: async () => user.email ?? null,
    ensureProfile: () => upsertOwnProfile(supabase, user),
    bootstrap: async (name) => {
      const { data, error: e } = await supabase.rpc('bootstrap_account', { account_name: name });
      if (e) throw e;
      return data as string;
    },
  });

  // RLS already scopes reads to account members; the explicit account_id eq
  // double-scopes so a foreign id can never resolve.
  const { data: row } = await supabase
    .from('diagnoses')
    .select('map, letter, kind, label')
    .eq('id', id)
    .eq('account_id', accountId)
    .maybeSingle<DiagnosisDetailRow>();

  const map = row?.map;
  const hasDiagnosis = !!map && Array.isArray(map.workflows) && map.workflows.length > 0;
  if (!row || !hasDiagnosis) redirect('/app/diagnosis');

  const kindLabel = row.kind === 'quick_scan' ? 'Quick scan' : '14-day study';

  return (
    <AppShell active="diagnosis" title="Your diagnosis" email={user.email}>
      <header className={styles.header}>
        <Link href="/app/diagnosis" className={styles.backLink}>
          ← All maps
        </Link>
        <div className={styles.detailHead}>
          <Badge tone={row.kind === 'quick_scan' ? 'sky' : 'moss'}>{kindLabel}</Badge>
          {row.label && <span className={styles.detailLabel}>{row.label}</span>}
        </div>
        <h1 className={styles.title}>Where your time went</h1>
        <p className={styles.subtitle}>Grown from your Field Study — only the map ever left your device.</p>
      </header>

      <DiagnosisReveal map={map} letter={row.letter} />
    </AppShell>
  );
}
