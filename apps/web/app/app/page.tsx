import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import {
  buildCreature,
  type Accessory,
  type Marking,
  type SpeciesName,
  type Stage,
} from '@nibbin/creatures';
import { createClient } from '../../lib/supabase/server';
import { ensureAccount } from '../../lib/auth/bootstrap';
import { upsertOwnProfile } from '../../lib/auth/profile';
import { loadGroveState } from '../../lib/grove/load';
import { AppShell } from '../../components/shell/AppShell';
import { Card, Badge, InlineFeedback } from '../../components/ui';
import { KeeperPanel } from './grove/KeeperPanel';
import type { Celebration } from './grove/KeeperChat';
import { OnboardingCanvas } from './grove/OnboardingCanvas';
import { decideRunAction } from './actions';
import styles from './app.module.css';
import dash from './dashboard.module.css';
import home from './home.module.css';

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

/** Clock time for the done feed, e.g. "7:42 AM". */
function clock(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

// ── Time-saved ESTIMATE (§not stored — derived from real run_steps) ──────────
// There is no measured "minutes saved" field. We estimate it from the work the
// run actually did: each automated step is treated as ~3 minutes of manual
// effort it stood in for. So estMinutesSaved(run) = (its run_steps count) × 3.
// Every surfaced figure is prefixed "~" and footnoted as an estimate — it is a
// transparent derivation from real step counts, never a fabricated exact number.
const MINUTES_PER_STEP = 3;

/** "~Xh Ym" / "~X.X hrs" / "~Nm", matching the demo's compact formatting. */
function fmtSaved(totalMinutes: number): string {
  if (totalMinutes <= 0) return '~0m';
  if (totalMinutes < 60) return `~${Math.round(totalMinutes)}m`;
  const hours = totalMinutes / 60;
  // ≥ a couple hours reads better as a single decimal (demo: "6.4 hrs").
  if (hours >= 2) return `~${hours.toFixed(1)} hrs`;
  const h = Math.floor(hours);
  const m = Math.round(totalMinutes - h * 60);
  return m > 0 ? `~${h}h ${m}m` : `~${h}h`;
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

interface SpecRow {
  display_name: string | null;
  template_key: string | null;
}
interface NibbinRow {
  id: string;
  name: string;
  stage: string;
  status: string;
  species: string;
  paused_reason: string | null;
  palette: string | null;
  accessory: string | null;
  marking: string | null;
  stage_changed_at: string;
  agent_specs: SpecRow | SpecRow[] | null;
}
interface RunRow {
  id: string;
  nibbin_id: string;
  status: string;
  created_at: string;
  ended_at: string | null;
}

function specOf(n: NibbinRow): SpecRow | null {
  const s = n.agent_specs;
  return Array.isArray(s) ? (s[0] ?? null) : s;
}

/** Spec-derived "job" line (never fabricated) — mirrors the roster page. */
function jobOf(n: NibbinRow): string {
  const s = specOf(n);
  if (s?.display_name && s.display_name.trim()) return s.display_name.trim();
  if (s?.template_key && s.template_key.trim()) {
    return s.template_key.trim().replace(/[-_]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  }
  return 'its work';
}

function creatureFor(n: NibbinRow, size: number): string {
  return buildCreature({
    species: n.species as SpeciesName,
    stage: n.stage as Stage,
    color: n.palette ?? undefined,
    acc: (n.accessory ?? 'none') as Accessory,
    mark: (n.marking ?? 'none') as Marking,
    size,
  });
}

// §4.7 promotion window (mirrors nibbin_promote SQL defaults + the roster page).
const PROMOTION_WINDOW = 25;
const PROMOTION_NEEDED = Math.ceil(0.95 * PROMOTION_WINDOW); // 24 clean of 25

export default async function AppPage({ searchParams }: { searchParams: Promise<{ adopted?: string }> }) {
  const { adopted } = await searchParams;
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
  const [groveLoad, { data: account }, { count: activeConnectionCount }] = await Promise.all([
    loadGroveState(supabase, accountId, user.id),
    supabase.from('accounts').select('name').eq('id', accountId).single(),
    // NIB-4: does the account have a working (active) connection yet? Drives the
    // first-connection next-step affordance. RLS-scoped to the user's session;
    // `pending` rows (half-finished OAuth) deliberately don't count.
    supabase
      .from('connections')
      .select('id', { count: 'exact', head: true })
      .eq('account_id', accountId)
      .eq('status', 'active'),
  ]);

  const { state: grove, initialMessages, expression, credits } = groveLoad;
  const hasConnection = (activeConnectionCount ?? 0) > 0;

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
          hasConnection={hasConnection}
        />
      </AppShell>
    );
  }

  // §6.2: a top-up since last visit should quietly unblock cap-queued runs.
  // (Moved here from the retired /app/grove route — Grove Home is now the landing.)
  const { resumeQueuedRuns } = await import('../../lib/runtime/engine');
  await resumeQueuedRuns(accountId).catch(() => 0);

  // Time-saved window: the start of the last 7 days (UTC-day aligned, like the
  // anomaly window) — completed runs in this span feed both "today" and "week".
  const now = Date.now();
  const todayStart = new Date(now);
  todayStart.setHours(0, 0, 0, 0);
  const weekStart = new Date(now - 7 * 24 * 60 * 60 * 1000);

  const [
    { data: nibbinsData },
    { count: waitingCount },
    { count: queuedCount },
    { data: runsData },
    { data: weekCompletedData },
    { data: approvalsData },
    { data: promoNotifData },
  ] = await Promise.all([
    supabase
      .from('nibbins')
      .select(
        'id, name, stage, status, species, paused_reason, palette, accessory, marking, stage_changed_at, agent_specs(display_name, template_key)',
      )
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
    // Recent runs (any status) for the queue + done feed + activity ledger.
    supabase
      .from('runs')
      .select('id, nibbin_id, status, created_at, ended_at')
      .eq('account_id', accountId)
      .order('created_at', { ascending: false })
      .limit(40),
    // Completed runs in the last 7 days — the time-saved estimate basis.
    supabase
      .from('runs')
      .select('id, nibbin_id, status, created_at, ended_at')
      .eq('account_id', accountId)
      .eq('status', 'completed')
      .gte('ended_at', weekStart.toISOString()),
    // Approvals (account-wide, newest first) — fuels the honest "Coming up"
    // graduation-window line, same source the roster page reads.
    supabase
      .from('approvals')
      .select('run_id, decision, edit_distance, decided_at')
      .eq('account_id', accountId)
      .order('decided_at', { ascending: false }),
    // Recent promotions (Beat 3) — celebrated in-grove on first sight (per-device).
    supabase
      .from('notifications')
      .select('id, kind, title, body, payload, created_at')
      .eq('account_id', accountId)
      .in('kind', ['evolution', 'graduation'])
      .gte('created_at', new Date(now - 14 * 24 * 60 * 60 * 1000).toISOString())
      .order('created_at', { ascending: false })
      .limit(5),
  ]);

  const nibbins = (nibbinsData ?? []) as unknown as NibbinRow[];
  const recentRuns = (runsData ?? []) as RunRow[];
  const weekCompleted = (weekCompletedData ?? []) as RunRow[];
  const approvals = (approvalsData ?? []) as {
    run_id: string;
    decision: string;
    edit_distance: number;
    decided_at: string;
  }[];
  const pendingCelebrations: Celebration[] = (
    (promoNotifData ?? []) as Array<{
      id: string;
      kind: string;
      title: string;
      body: string;
      payload: {
        species?: string; stage?: string; palette?: string | null; accessory?: string; marking?: string;
      } | null;
    }>
  )
    .filter((r) => r.payload?.species && (r.kind === 'evolution' || r.kind === 'graduation'))
    .map((r) => ({
      id: r.id,
      kind: r.kind as 'evolution' | 'graduation',
      title: r.title,
      line: r.body,
      species: r.payload!.species as string,
      stage: r.payload!.stage as string,
      palette: (r.payload!.palette as string) ?? null,
      accessory: (r.payload!.accessory as string) ?? 'none',
      marking: (r.payload!.marking as string) ?? 'none',
    }));
  const nibbinOf = (id: string) => nibbins.find((n) => n.id === id) ?? null;
  const nameOf = (id: string) => nibbinOf(id)?.name ?? 'A Nibbin';

  const awaiting = recentRuns.filter((r) => r.status === 'awaiting_approval').slice(0, 5);
  const doneFeed = recentRuns.filter((r) => r.status === 'completed').slice(0, 8);
  const ledger = recentRuns.slice(0, 8);
  const runCounts = new Map<string, number>();
  for (const run of recentRuns) runCounts.set(run.nibbin_id, (runCounts.get(run.nibbin_id) ?? 0) + 1);
  const activeNibbins = nibbins.filter((n) => n.status === 'active').length;
  const waiting = waitingCount ?? 0;

  // ── Per-run step counts → time-saved estimate ──────────────────────────────
  // One step query for every run we need a count or description for (the queue,
  // the done feed, and every completed run in the week window). The estimate is
  // (step count) × MINUTES_PER_STEP — see fmtSaved/MINUTES_PER_STEP above.
  const stepRunIds = Array.from(
    new Set([...awaiting, ...doneFeed, ...weekCompleted].map((r) => r.id)),
  );
  const stepCounts = new Map<string, number>();
  const draftTitle = new Map<string, string>();
  if (stepRunIds.length > 0) {
    const { data: stepsData } = await supabase
      .from('run_steps')
      .select('run_id, kind, payload')
      .eq('account_id', accountId)
      .in('run_id', stepRunIds);
    for (const s of stepsData ?? []) {
      const rid = s.run_id as string;
      stepCounts.set(rid, (stepCounts.get(rid) ?? 0) + 1);
      // The draft step's payload.title is a real, run-authored summary of the
      // work — the honest short description for the draft + done cards.
      if (s.kind === 'draft' && !draftTitle.has(rid)) {
        const t = (s.payload as Record<string, unknown> | null)?.title;
        if (typeof t === 'string' && t.trim()) draftTitle.set(rid, t.trim());
      }
    }
  }

  const stepsOf = (runId: string) => stepCounts.get(runId) ?? 0;
  const savedMinutesOf = (runId: string) => stepsOf(runId) * MINUTES_PER_STEP;

  const savedToday = weekCompleted
    .filter((r) => r.ended_at && new Date(r.ended_at).getTime() >= todayStart.getTime())
    .reduce((sum, r) => sum + savedMinutesOf(r.id), 0);
  const savedWeek = weekCompleted.reduce((sum, r) => sum + savedMinutesOf(r.id), 0);

  // Approvals indexed by the nibbin their run belongs to (for graduation math).
  const runToNibbin = new Map<string, string>();
  for (const r of recentRuns) runToNibbin.set(r.id, r.nibbin_id);
  for (const r of weekCompleted) runToNibbin.set(r.id, r.nibbin_id);
  const approvalsByNibbin = new Map<string, typeof approvals>();
  for (const a of approvals) {
    const nid = runToNibbin.get(a.run_id);
    if (!nid) continue;
    const list = approvalsByNibbin.get(nid) ?? [];
    list.push(a);
    approvalsByNibbin.set(nid, list);
  }

  // Honest "Coming up" line per active nibbin: a graduate/senior near the bar
  // gets its remaining-clean-runs count; everyone else gets the watching line.
  function comingUpLine(n: NibbinRow): string {
    if (n.stage === 'grad') return `${n.name} is acting on its own — watching ${jobOf(n)}`;
    const rows = (approvalsByNibbin.get(n.id) ?? [])
      .filter((a) => new Date(a.decided_at).getTime() > new Date(n.stage_changed_at).getTime())
      .slice(0, PROMOTION_WINDOW);
    const clean = rows.filter((a) => a.decision === 'approved' && a.edit_distance === 0).length;
    if (rows.length >= PROMOTION_WINDOW) {
      const remaining = Math.max(0, PROMOTION_NEEDED - clean);
      if (remaining > 0) {
        return `${n.name} is ${remaining} clean ${remaining === 1 ? 'run' : 'runs'} from graduating`;
      }
      return `${n.name} meets the graduation bar — review to promote`;
    }
    return `${n.name} is watching ${jobOf(n)}`;
  }
  const comingUp = nibbins.filter((n) => n.status === 'active');

  const keeperPanel = (
    <KeeperPanel
      initialMessages={initialMessages}
      initialExpression={expression}
      initialStep={grove.step}
      keeperName={grove.keeperName}
      credits={credits}
      initialProfile={grove.profile}
      hasConnection={hasConnection}
      pendingCelebrations={pendingCelebrations}
    />
  );

  return (
    <AppShell active="grove" title="Your grove" email={user.email} panel={keeperPanel}>
      {adopted && (
        <InlineFeedback tone="success">Adopted — your new Nibbin is in the grove.</InlineFeedback>
      )}
      <header className={dash.header}>
        <p className={dash.eyebrow}>Your grove · Today</p>
        {/* Greet by the user's display first name (captured in onboarding, stored
            in users.name); fall back to the grove/account name, then a generic. */}
        <h1 className={dash.title}>
          {grove.userName?.trim().split(/\s+/)[0] || account?.name || 'Your grove'}
        </h1>
        {grove.keeperName && (
          <p className={dash.subtitle}>{grove.keeperName} is keeping things tidy.</p>
        )}
      </header>

      {/* Time-saved chipline. Time-saved is an ESTIMATE from real step counts
          (see MINUTES_PER_STEP) — shown with a leading "~" and footnoted. */}
      <div className={home.chipline}>
        <div className={home.chipItem}>
          {new Date().toLocaleDateString(undefined, { weekday: 'long' }).toUpperCase()}
          <b>{new Date().toLocaleDateString(undefined, { month: 'long', day: 'numeric' })}</b>
        </div>
        <div className={home.chipItem}>
          TIME SAVED TODAY
          <b className={home.chipMoss}>{fmtSaved(savedToday)}</b>
        </div>
        <div className={home.chipItem}>
          THIS WEEK
          <b className={home.chipMoss}>{fmtSaved(savedWeek)}</b>
        </div>
        <div className={home.chipItem}>
          NEEDS YOUR EYES
          <b className={home.chipCoral}>
            {waiting} {waiting === 1 ? 'item' : 'items'}
          </b>
        </div>
      </div>
      <p
        className={home.chipFootnote}
        title="Time saved is estimated from steps automated — roughly 3 minutes of manual work per step. It is an estimate, not a measured figure."
      >
        ~ Time saved is estimated from steps automated (≈{MINUTES_PER_STEP} min per step) — an
        estimate, not a measured number.
      </p>

      <div className={home.todayGrid}>
        {/* Left: the awaiting_approval queue as draft cards. The yes/no reuses
            the existing decide_run path (decideRunAction → decideDraft). */}
        <div className={home.tcard}>
          <div className={home.tcardHead}>Needs you — your only to-do</div>
          {awaiting.length === 0 ? (
            <p className={home.emptyToday}>
              Nothing needs your yes right now. When a Nibbin drafts something, it lands here.
            </p>
          ) : (
            <div className={home.draftStack}>
              {awaiting.map((run) => {
                const n = nibbinOf(run.nibbin_id);
                const steps = stepsOf(run.id);
                const what = draftTitle.get(run.id);
                return (
                  <div className={home.draftCard} key={run.id}>
                    {n && (
                      <span
                        className={home.who}
                        aria-hidden="true"
                        dangerouslySetInnerHTML={{ __html: creatureFor(n, 46) }}
                      />
                    )}
                    <div className={home.draftBody}>
                      <div className={home.what}>
                        <b>{nameOf(run.nibbin_id)}</b> drafted {what ?? 'something for your review'}
                      </div>
                      <div className={home.meta}>
                        drafted {ago(run.created_at)}
                        {steps > 0 && ` · ${steps} ${steps === 1 ? 'step' : 'steps'}`}
                      </div>
                      <div className={home.qbtns}>
                        <form action={decideRunAction} className={home.qbtnForm}>
                          <input type="hidden" name="runId" value={run.id} />
                          <input type="hidden" name="decision" value="approved" />
                          <button className={`${home.qbtn} ${home.qbtnOk}`} type="submit">
                            Approve &amp; send
                          </button>
                        </form>
                        {/* Editing is a chat interaction (the edit distance that
                            feeds promotion is captured there) — link to the panel. */}
                        <a className={`${home.qbtn} ${home.qbtnEdit}`} href="/app/grove">
                          Edit first
                        </a>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Right: done-while-you-were-working feed + honest coming-up. */}
        <div>
          <div className={home.tcard}>
            <div className={home.tcardHead}>Done while you were working</div>
            {doneFeed.length === 0 ? (
              <p className={home.emptyToday}>
                Nothing finished yet today. Completed work shows up here as it lands.
              </p>
            ) : (
              doneFeed.map((run) => {
                const n = nibbinOf(run.nibbin_id);
                const steps = stepsOf(run.id);
                const saved = savedMinutesOf(run.id);
                const what = draftTitle.get(run.id);
                return (
                  <div className={home.feedItem} key={run.id}>
                    {n && (
                      <span
                        className={home.who}
                        aria-hidden="true"
                        dangerouslySetInnerHTML={{ __html: creatureFor(n, 46) }}
                      />
                    )}
                    <div>
                      <div className={home.what}>
                        <b>{nameOf(run.nibbin_id)}</b> {what ? `delivered ${what}` : 'finished a task'}
                      </div>
                      <div className={home.meta}>
                        {clock(run.ended_at ?? run.created_at)}
                        {steps > 0 && ` · ${steps} ${steps === 1 ? 'step' : 'steps'}`}
                        {steps > 0 && (
                          <>
                            {' · '}
                            <b>~saved {fmtSaved(saved).replace(/^~/, '')}</b>
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>

          {comingUp.length > 0 && (
            <div className={home.tcard}>
              <div className={home.tcardHead}>Coming up</div>
              {comingUp.map((n) => (
                <div className={home.feedItem} key={n.id}>
                  <span
                    className={home.who}
                    aria-hidden="true"
                    dangerouslySetInnerHTML={{ __html: creatureFor(n, 46) }}
                  />
                  <div>
                    <div className={home.what}>{comingUpLine(n)}</div>
                    <div className={home.meta}>
                      {STAGE_LABEL[n.stage] ?? n.stage} · {jobOf(n)}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

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

      <Card id="download" className={dash.download}>
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
