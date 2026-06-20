import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createClient } from '../../../lib/supabase/server';
import { ensureAccount } from '../../../lib/auth/bootstrap';
import { upsertOwnProfile } from '../../../lib/auth/profile';
import { AppShell } from '../../../components/shell/AppShell';
import { Badge, Card, EmptyState, InlineFeedback } from '../../../components/ui';
import type { DiagnosisMap } from '../../../lib/diagnosis/types';
import { DiagnosisReveal } from './DiagnosisReveal';
import styles from './diagnosis.module.css';

export const metadata: Metadata = { title: 'Your diagnosis — Nibbin' };
export const dynamic = 'force-dynamic';

type DiagnosisKind = 'full_study' | 'quick_scan';

interface DiagnosisRow {
  id: string;
  map: DiagnosisMap;
  letter: string | null;
  kind: DiagnosisKind | null;
  label: string | null;
  created_at: string;
  packet: { capturedFrom?: string; capturedTo?: string } | null;
}

const DATE_FMT = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
});

function kindLabel(kind: DiagnosisKind | null): string {
  return kind === 'quick_scan' ? 'Quick scan' : '14-day study';
}

export default async function DiagnosisPage({
  searchParams,
}: {
  searchParams: Promise<{ needs?: string; error?: string }>;
}) {
  const { needs, error } = await searchParams;

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

  const { data: rows } = await supabase
    .from('diagnoses')
    .select('id, map, letter, kind, label, created_at, packet')
    .eq('account_id', accountId)
    .order('created_at', { ascending: false })
    .limit(50)
    .returns<DiagnosisRow[]>();

  const all = rows ?? [];
  const newest = all[0];
  const newestMap = newest?.map;
  const hasDiagnosis =
    !!newestMap && Array.isArray(newestMap.workflows) && newestMap.workflows.length > 0;
  const older = all.slice(1);

  return (
    <AppShell active="diagnosis" title="Your diagnosis" email={user.email}>
      <header className={styles.header}>
        <p className={styles.eyebrow}>The diagnosis</p>
        <h1 className={styles.title}>Where your week actually goes</h1>
        <p className={styles.subtitle}>Grown from your Field Study — only the map ever left your device.</p>
      </header>

      {needs && (
        <InlineFeedback tone="error">
          That helper needs a connection first ({needs}). Connect it, then adopt.
        </InlineFeedback>
      )}
      {error && <InlineFeedback tone="error">That didn’t go through — give it another try.</InlineFeedback>}

      {!hasDiagnosis ? (
        <EmptyState
          title="No map yet"
          body="Run the 14-day Field Study from the desktop app and your map grows in here — where your hours go, and the chores your grove can take on."
        />
      ) : (
        <>
          <DiagnosisReveal
            map={newestMap}
            letter={newest.letter}
            diagnosisId={newest.id}
            window={
              newest.packet?.capturedFrom && newest.packet?.capturedTo
                ? { from: newest.packet.capturedFrom, to: newest.packet.capturedTo }
                : undefined
            }
          />

          {older.length > 0 && (
            <>
              <h2 className={styles.sectionTitle}>Earlier maps</h2>
              <p className={styles.muted}>Every study and quick scan you’ve grown, newest first.</p>
              <div className={styles.historyList}>
                {older.map((d) => {
                  const m = d.map;
                  const wfCount = Array.isArray(m?.workflows) ? m.workflows.length : 0;
                  return (
                    <Link key={d.id} href={`/app/diagnosis/${d.id}`} className={styles.historyLink}>
                      <Card className={styles.historyCard}>
                        <div className={styles.historyHead}>
                          <Badge tone={d.kind === 'quick_scan' ? 'sky' : 'moss'}>
                            {kindLabel(d.kind)}
                          </Badge>
                          {d.label && <span className={styles.historyTitle}>{d.label}</span>}
                          <span className={styles.historyDate}>{DATE_FMT.format(new Date(d.created_at))}</span>
                        </div>
                        <p className={styles.historyMeta}>
                          {m?.totalHoursPerWeek ?? 0}h a week across {wfCount}{' '}
                          {wfCount === 1 ? 'workflow' : 'workflows'}
                        </p>
                      </Card>
                    </Link>
                  );
                })}
              </div>
            </>
          )}
        </>
      )}
    </AppShell>
  );
}
