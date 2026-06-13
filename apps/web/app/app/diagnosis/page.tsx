import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { createClient } from '../../../lib/supabase/server';
import { ensureAccount } from '../../../lib/auth/bootstrap';
import { upsertOwnProfile } from '../../../lib/auth/profile';
import { AppShell } from '../../../components/shell/AppShell';
import { Badge, Button, Card, InlineFeedback } from '../../../components/ui';
import type { DiagnosisMap, Frequency } from '../../../lib/diagnosis/types';
import { adoptRecommendation } from './actions';
import styles from './diagnosis.module.css';

export const metadata: Metadata = { title: 'Your diagnosis — Nibbin' };
export const dynamic = 'force-dynamic';

const NIBBIN_NAME: Record<string, string> = {
  sweep: 'Sweep',
  echo: 'Echo',
  brief: 'Brief',
  tally: 'Tally',
  hopper: 'Hopper',
  scribe: 'Scribe',
};
const FREQ_TONE: Record<Frequency, 'honey' | 'sky' | 'neutral'> = {
  daily: 'honey',
  weekly: 'sky',
  occasional: 'neutral',
};
const FREQ_LABEL: Record<Frequency, string> = {
  daily: 'Daily',
  weekly: 'Weekly',
  occasional: 'Now and then',
};

interface DiagnosisRow {
  map: DiagnosisMap;
  letter: string | null;
  status: string;
  created_at: string;
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

  const { data: row } = await supabase
    .from('diagnoses')
    .select('map, letter, status, created_at')
    .eq('account_id', accountId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle<DiagnosisRow>();

  const map = row?.map;
  const hasDiagnosis = !!map && Array.isArray(map.workflows) && map.workflows.length > 0;

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
        <Card>
          <p className={`${styles.muted} ${styles.empty}`}>
            Your diagnosis isn’t ready yet. Run the 14-day Field Study from the desktop app and your
            map grows in here — where your hours go, and the chores your grove can take on.
          </p>
        </Card>
      ) : (
        <>
          {row?.letter && (
            <Card className={styles.letterCard}>
              <p className={styles.letterEyebrow}>A letter from the Grovekeeper</p>
              <p className={styles.letter}>{row.letter}</p>
            </Card>
          )}

          <div className={styles.total}>
            <span className={styles.totalValue}>{map.totalHoursPerWeek}h</span>
            <span className={styles.totalLabel}>
              of routine a week, mapped across {map.workflows.length}{' '}
              {map.workflows.length === 1 ? 'workflow' : 'workflows'}
            </span>
          </div>

          <h2 className={styles.sectionTitle}>Where the hours go</h2>
          <div className={styles.wfList}>
            {map.workflows.map((w) => (
              <Card key={w.key} className={styles.wfCard}>
                <div className={styles.wfHead}>
                  <span className={styles.wfName}>{w.label}</span>
                  <span className={styles.wfHours}>~{w.hoursPerWeek}h / week</span>
                </div>
                <div className={styles.wfMeta}>
                  <Badge tone={FREQ_TONE[w.frequency]}>{FREQ_LABEL[w.frequency]}</Badge>
                  <Badge tone="neutral">{w.category}</Badge>
                  {w.recommendedNibbin && (
                    <Badge tone="moss">{NIBBIN_NAME[w.recommendedNibbin] ?? w.recommendedNibbin} can help</Badge>
                  )}
                </div>
                {w.description && <p className={styles.wfDesc}>{w.description}</p>}
                {w.friction && <p className={styles.wfFriction}>{w.friction}</p>}
              </Card>
            ))}
          </div>

          {map.topRecommendations.length > 0 && (
            <>
              <h2 className={styles.sectionTitle}>Ready to take the first slices</h2>
              <div className={styles.wfList}>
                {map.topRecommendations.map((key) => (
                  <Card key={key} className={styles.wfCard}>
                    <div className={styles.recRow}>
                      <span className={styles.recText}>
                        Adopt <strong>{NIBBIN_NAME[key] ?? key}</strong> to start handling this — drafts
                        only, for your approval, until it earns more.
                      </span>
                      <form className={styles.recForm} action={adoptRecommendation}>
                        <input type="hidden" name="templateKey" value={key} />
                        <Button type="submit" variant="primary">
                          Adopt {NIBBIN_NAME[key] ?? key}
                        </Button>
                      </form>
                    </div>
                  </Card>
                ))}
              </div>
            </>
          )}
        </>
      )}
    </AppShell>
  );
}
