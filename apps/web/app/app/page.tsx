import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { createClient } from '../../lib/supabase/server';
import { ensureAccount } from '../../lib/auth/bootstrap';
import { upsertOwnProfile } from '../../lib/auth/profile';
import { loadGroveState } from '../../lib/grove/load';
import { AppShell } from '../../components/shell/AppShell';
import { Card, Badge } from '../../components/ui';
import { KeeperPanel } from './grove/KeeperPanel';
import { OnboardingCanvas } from './grove/OnboardingCanvas';
import styles from './app.module.css';
import dash from './dashboard.module.css';

export const metadata: Metadata = { title: 'Your grove — Nibbin' };

// Force dynamic: this page reads the per-request session.
export const dynamic = 'force-dynamic';

type Tone = 'moss' | 'honey' | 'sky' | 'coral' | 'neutral';

const STAGE_LABEL: Record<string, string> = {
  egg: 'Egg',
  student: 'Student',
  senior: 'Senior',
  grad: 'Graduate',
};
const STAGE_TONE: Record<string, Tone> = {
  egg: 'neutral',
  student: 'sky',
  senior: 'moss',
  grad: 'honey',
};
const NIBBIN_STATUS_TONE: Record<string, Tone> = {
  active: 'moss',
  paused: 'honey',
  sleeping: 'neutral',
};
const RUN_PHRASE: Record<string, string> = {
  completed: 'finished a task',
  awaiting_approval: 'left a draft for your yes',
  running: 'is working now',
  queued: 'is waiting for credits',
  rejected: 'had a draft turned down',
  failed: 'hit a snag',
  killed: 'was stopped',
};

function ago(iso: string): string {
  const minutes = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}

function SignOut() {
  return (
    <form action="/auth/signout" method="post">
      <button className={styles.signout} type="submit">
        Sign out
      </button>
    </form>
  );
}

interface NibbinRow {
  id: string;
  name: string;
  stage: string;
  status: string;
  species: string;
  paused_reason: string | null;
}
interface RunRow {
  id: string;
  nibbin_id: string;
  status: string;
  created_at: string;
}

export default async function AppPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  // Idempotent + race-safe (advisory-locked RPC). Safe to run on every load.
  let accountId: string;
  try {
    accountId = await ensureAccount({
      getEmail: async () => user.email ?? null,
      ensureProfile: () => upsertOwnProfile(supabase, user),
      bootstrap: async (name) => {
        const { data, error } = await supabase.rpc('bootstrap_account', { account_name: name });
        if (error) throw error;
        return data as string;
      },
    });
  } catch {
    // Render the snag inline — redirecting to /login would just bounce back here
    // (middleware sends signed-in users to /app), looping the user.
    return (
      <main className={styles.wrap}>
        <div className={styles.card}>
          <p className={styles.eyebrow}>Your grove</p>
          <h1 className={styles.heading}>Just a moment</h1>
          <p className={styles.body}>
            You&apos;re signed in, but I hit a snag setting up your grove. Refresh in a moment and
            it should settle.
          </p>
          <p className={styles.note} />
          <SignOut />
        </div>
      </main>
    );
  }

  // Every read below is gated by RLS on the user's own session — this is the
  // live demonstration that membership scoping holds at the database layer.
  const [groveLoad, { data: account }] = await Promise.all([
    loadGroveState(supabase, accountId, user.id),
    supabase.from('accounts').select('name').eq('id', accountId).single(),
  ]);

  const { state: grove, initialMessages, expression, credits } = groveLoad;

  // Onboarding not yet complete: render the focal OnboardingCanvas inside the
  // shell (nav quiet + locked). The canvas handles the chat engine + hatch
  // delight + stepper; on completion the handoff screen appears and the user
  // follows the download link or clicks "take me to my grove" to navigate here
  // again (at which point step === 'done' and the dashboard renders).
  if (grove.step !== 'done') {
    return (
      <AppShell onboarding title="Welcome" email={user.email}>
        <OnboardingCanvas
          initialMessages={initialMessages}
          initialExpression={expression}
          initialStep={grove.step}
          keeperName={grove.keeperName}
          freshHatch={!groveLoad.rowExists}
          credits={credits}
          initialProfile={grove.profile}
        />
      </AppShell>
    );
  }

  const [{ data: nibbinsData }, { count: waitingCount }, { count: queuedCount }, { data: runsData }] =
    await Promise.all([
      supabase
        .from('nibbins')
        .select('id, name, stage, status, species, paused_reason')
        .eq('account_id', accountId)
        .eq('kind', 'specialist')
        .order('hatched_at', { ascending: true }),
      supabase
        .from('runs')
        .select('id', { count: 'exact', head: true })
        .eq('account_id', accountId)
        .eq('status', 'awaiting_approval'),
      supabase
        .from('runs')
        .select('id', { count: 'exact', head: true })
        .eq('account_id', accountId)
        .eq('status', 'queued'),
      supabase
        .from('runs')
        .select('id, nibbin_id, status, created_at')
        .eq('account_id', accountId)
        .order('created_at', { ascending: false })
        .limit(40),
    ]);

  const nibbins = (nibbinsData ?? []) as NibbinRow[];
  const recentRuns = (runsData ?? []) as RunRow[];
  const nameOf = (id: string) => nibbins.find((n) => n.id === id)?.name ?? 'A Nibbin';

  const awaiting = recentRuns.filter((r) => r.status === 'awaiting_approval').slice(0, 5);
  const ledger = recentRuns.slice(0, 8);
  const runCounts = new Map<string, number>();
  for (const run of recentRuns) runCounts.set(run.nibbin_id, (runCounts.get(run.nibbin_id) ?? 0) + 1);
  const activeNibbins = nibbins.filter((n) => n.status === 'active').length;
  const waiting = waitingCount ?? 0;

  const keeperPanel = (
    <KeeperPanel
      initialMessages={initialMessages}
      initialExpression={expression}
      initialStep={grove.step}
      keeperName={grove.keeperName}
      credits={credits}
      initialProfile={grove.profile}
    />
  );

  return (
    <AppShell title="Your grove" email={user.email} panel={keeperPanel}>
      <header className={dash.header}>
        <p className={dash.eyebrow}>Your grove</p>
        <h1 className={dash.title}>{account?.name ?? 'Your grove'}</h1>
        {grove.keeperName && (
          <p className={dash.subtitle}>{grove.keeperName} is keeping things tidy.</p>
        )}
      </header>

      {/* Approval queue — the heartbeat. The yes/no itself happens in the grove. */}
      <Card className={`${dash.hero} ${awaiting.length === 0 ? dash.heroCaughtUp : ''}`}>
        <p className={dash.heroEyebrow}>Waiting on you</p>
        {awaiting.length > 0 ? (
          <>
            <h2 className={dash.heroTitle}>
              {waiting} {waiting === 1 ? 'draft needs' : 'drafts need'} your yes
            </h2>
            <ul className={dash.heroList}>
              {awaiting.map((run) => (
                <li key={run.id} className={dash.heroItem}>
                  <span>{nameOf(run.nibbin_id)} left a draft</span>
                  <span className={dash.ledgerWhen}>{ago(run.created_at)}</span>
                </li>
              ))}
            </ul>
            <a className={dash.cta} href="/app/grove">
              Review in your grove →
            </a>
          </>
        ) : (
          <>
            <h2 className={dash.heroTitle}>You’re all caught up</h2>
            <p className={dash.heroEmpty}>
              Nothing needs your yes right now. When a Nibbin drafts something, it lands here.
            </p>
          </>
        )}
      </Card>

      <div className={dash.stats}>
        <div className={dash.stat}>
          <div className={dash.statLabel}>Credits</div>
          <div className={dash.statValue}>{credits.toLocaleString()}</div>
        </div>
        <div className={dash.stat}>
          <div className={dash.statLabel}>Waiting on you</div>
          <div className={dash.statValue}>{waiting}</div>
        </div>
        <div className={dash.stat}>
          <div className={dash.statLabel}>Active Nibbins</div>
          <div className={dash.statValue}>{activeNibbins}</div>
        </div>
      </div>

      <Card className={dash.download}>
        <div className={dash.downloadCopy}>
          <p className={dash.heroEyebrow}>Get the desktop app</p>
          <h2 className={dash.downloadTitle}>Your grove runs in the desktop app</h2>
          <p className={dash.heroEmpty}>
            That&apos;s where your Nibbins connect to your accounts and do the work. Install it on
            the machine you work from.
          </p>
        </div>
        <div className={dash.downloadRow}>
          <a className={dash.dlBtn} href="/download/mac">
            <span className={dash.dlIcon} aria-hidden="true">
              <svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor">
                <path d="M11.18 8.46c-.02-1.78 1.45-2.63 1.52-2.67-.83-1.21-2.12-1.38-2.58-1.4-1.1-.11-2.14.64-2.7.64-.55 0-1.41-.63-2.32-.61-1.2.02-2.3.69-2.91 1.76-1.24 2.15-.32 5.33.89 7.07.59.85 1.29 1.81 2.21 1.77.89-.04 1.22-.57 2.3-.57 1.07 0 1.37.57 2.31.55.95-.02 1.56-.87 2.14-1.72.67-.99.95-1.94.96-1.99-.02-.01-1.84-.71-1.86-2.8zM9.6 3.24c.49-.59.82-1.42.73-2.24-.71.03-1.56.47-2.06 1.06-.45.52-.85 1.36-.74 2.16.79.06 1.59-.4 2.07-.98z" />
              </svg>
            </span>
            Download for macOS
          </a>
          <a className={dash.dlBtn} href="/download/windows">
            <span className={dash.dlIcon} aria-hidden="true">
              <svg viewBox="0 0 16 16" width="15" height="15" fill="currentColor">
                <path d="M0 2.4l6.5-.9v6.3H0V2.4zm0 11.2l6.5.9V8.2H0v5.4zM7.3 1.4L16 0v7.8H7.3V1.4zm0 13.2L16 16V8.2H7.3v6.4z" />
              </svg>
            </span>
            Download for Windows
          </a>
        </div>
      </Card>

      {(queuedCount ?? 0) > 0 && (
        <p className={dash.muted} role="status">
          {queuedCount} {queuedCount === 1 ? 'task is' : 'tasks are'} waiting for credits — they run
          the moment the meter refills. <a className={dash.cta} href="/billing">Top up or change plan →</a>
        </p>
      )}

      {nibbins.length > 0 && (
        <>
          <h2 className={dash.sectionTitle}>Your grove</h2>
          <div className={dash.grid}>
            {nibbins.map((nibbin) => {
              const runs = runCounts.get(nibbin.id) ?? 0;
              return (
                <Card key={nibbin.id} className={dash.nibbinCard}>
                  <div className={dash.nibbinHead}>
                    <span className={dash.nibbinName}>{nibbin.name}</span>
                    <Badge tone={STAGE_TONE[nibbin.stage] ?? 'neutral'}>
                      {STAGE_LABEL[nibbin.stage] ?? nibbin.stage}
                    </Badge>
                  </div>
                  <div className={dash.nibbinMeta}>
                    <Badge tone={NIBBIN_STATUS_TONE[nibbin.status] ?? 'neutral'}>
                      {nibbin.status === 'paused' && nibbin.paused_reason
                        ? `Paused · ${nibbin.paused_reason}`
                        : nibbin.status}
                    </Badge>
                    <span className={dash.nibbinRuns}>
                      {runs === 0 ? 'No recent runs' : `${runs} ${runs === 1 ? 'run' : 'runs'} lately`}
                    </span>
                  </div>
                </Card>
              );
            })}
          </div>
        </>
      )}

      <Card style={{ marginTop: 26 }}>
        <h2 className={dash.sectionTitleCard}>Recent activity</h2>
        {ledger.length === 0 ? (
          <p className={dash.muted}>Quiet so far — your grove’s comings and goings show up here.</p>
        ) : (
          <ul className={dash.ledger}>
            {ledger.map((run) => (
              <li key={run.id} className={dash.ledgerItem}>
                <span className={dash.ledgerText}>
                  <strong>{nameOf(run.nibbin_id)}</strong> {RUN_PHRASE[run.status] ?? run.status}
                </span>
                <span className={dash.ledgerWhen}>{ago(run.created_at)}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </AppShell>
  );
}
