import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { buildCreature, type Accessory, type Marking, type SpeciesName, type Stage } from '@nibbin/creatures';
import { appSession } from '../../../lib/auth/app-session';
import { AppShell } from '../../../components/shell/AppShell';
import { Tooltip, InfoTooltip } from '../../../components/ui/Tooltip';
import { NoteRefresher } from './NoteRefresher';
import { NibbinEditor } from './NibbinEditor';
import { BackToDrafts } from './BackToDrafts';
import { TrainingToggle, type TrainingState } from './TrainingToggle';
import { NibbinControls } from './NibbinControls';
import { refreshNibbinNote } from './actions';
import { RetuneDialog } from './RetuneDialog';
import styles from './nibbins.module.css';

export const metadata: Metadata = { title: 'Your Nibbins — Nibbin' };

// Per-request session read — never statically cached.
export const dynamic = 'force-dynamic';

// §4.7 Agent School: egg → student → senior → grad. The promotion window is the
// 25 most-recent decisions since stage_changed_at, threshold ≥95% approved-
// unedited. These constants mirror the SQL defaults in nibbin_promote().
const PROMOTION_WINDOW = 25;
const PROMOTION_PCT = 0.95;
// ceil(0.95 * 25) = 24 approved-unedited decisions needed in a full window.
const PROMOTION_NEEDED = Math.ceil(PROMOTION_PCT * PROMOTION_WINDOW);

// A Nibbin's learned-note is regenerated in the background once it has at least
// this many completed runs (enough signal for an honest line) AND either has no
// cached note yet, or has accumulated this many more runs since the note was
// last written (materially more history to learn from). Mirrors the generation
// module's MIN_COMPLETED gate.
const NOTE_MIN_COMPLETED = 3;
const NOTE_STALE_RUN_DELTA = 5;

const STAGE_RUNG: Record<Stage, number> = { egg: 1, student: 2, senior: 3, grad: 4 };
const STAGE_LABEL: Record<Stage, string> = {
  egg: 'Egg',
  student: 'Student',
  senior: 'Senior',
  grad: 'Graduate',
};
const STAGE_PILL_CLASS: Record<Stage, string> = {
  egg: styles.stEgg,
  student: styles.stStudent,
  senior: styles.stSenior,
  grad: styles.stGrad,
};

interface SpecRow {
  display_name: string | null;
  template_key: string | null;
  version: number | null;
}
interface NibbinRow {
  id: string;
  name: string;
  species: string;
  stage: Stage;
  status: string;
  paused_reason: string | null;
  palette: string | null;
  accessory: string | null;
  marking: string | null;
  stage_changed_at: string;
  hatched_at: string;
  learned_note: string | null;
  learned_note_runs: number;
  agent_specs: SpecRow | SpecRow[] | null;
}
interface RunRow {
  id: string;
  nibbin_id: string;
  status: string;
  created_at: string;
}
interface ApprovalRow {
  run_id: string;
  decision: string;
  edit_distance: number;
  decided_at: string;
}
interface TrainingRow {
  nibbin_id: string;
  expires_at: string;
  max_runs: number;
  runs_used: number;
}

function specOf(n: NibbinRow): SpecRow | null {
  const s = n.agent_specs;
  return Array.isArray(s) ? (s[0] ?? null) : s;
}

/** The spec version number, or null if not available yet. */
function specVersionOf(n: NibbinRow): number | null {
  return specOf(n)?.version ?? null;
}

/** The agent's "job" line: spec display name, falling back to a humanised
 *  template key, then a generic. Never fabricated — always spec-derived. */
function jobOf(n: NibbinRow): string {
  const s = specOf(n);
  if (s?.display_name && s.display_name.trim()) return s.display_name.trim();
  if (s?.template_key && s.template_key.trim()) {
    return s.template_key.trim().replace(/[-_]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  }
  return 'In Agent School';
}

interface Derived {
  runCount: number;
  completedCount: number;
  /** Decisions in the current-stage promotion window (≤25, since stage_changed_at). */
  windowDecided: number;
  windowApprovedUnedited: number;
  matchPct: number | null;
  /** Consecutive most-recent approved-unedited decisions. */
  cleanStreak: number;
  firstSolo: boolean;
  hundredRuns: boolean;
  zeroMissMonth: boolean;
}

/** Every number here is computed from real runs/approvals rows — nothing invented. */
function derive(runs: RunRow[], approvals: ApprovalRow[], stageChangedAt: string): Derived {
  const runCount = runs.length;
  const completedCount = runs.filter((r) => r.status === 'completed').length;

  // Approvals newest-first (decided_at desc). The DB caller already orders them,
  // but re-sort defensively so streak/window math is order-independent.
  const sorted = [...approvals].sort(
    (a, b) => new Date(b.decided_at).getTime() - new Date(a.decided_at).getTime(),
  );
  const isClean = (a: ApprovalRow) => a.decision === 'approved' && a.edit_distance === 0;

  // Promotion window: the most-recent ≤25 decisions made AFTER this stage began.
  const stageStart = new Date(stageChangedAt).getTime();
  const windowRows = sorted
    .filter((a) => new Date(a.decided_at).getTime() > stageStart)
    .slice(0, PROMOTION_WINDOW);
  const windowDecided = windowRows.length;
  const windowApprovedUnedited = windowRows.filter(isClean).length;
  const matchPct = windowDecided > 0 ? Math.round((windowApprovedUnedited / windowDecided) * 100) : null;

  // Streak: consecutive newest approved-unedited decisions (overall, not window-
  // scoped) — the demo's "n-run clean streak".
  let cleanStreak = 0;
  for (const a of sorted) {
    if (isClean(a)) cleanStreak++;
    else break;
  }

  // Badges — all from real rows.
  const firstSolo = completedCount >= 1; // ≥1 completed run
  const hundredRuns = runCount >= 100; // 100+ runs

  // Zero-Miss Month: ≥5 runs in the last 30 days whose decisions carried zero
  // rejected/edited outcomes (clean approvals only).
  const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
  const recentRunIds = new Set(
    runs.filter((r) => new Date(r.created_at).getTime() >= cutoff).map((r) => r.id),
  );
  const recentDecisions = approvals.filter((a) => recentRunIds.has(a.run_id));
  const anyMiss = recentDecisions.some((a) => a.decision !== 'approved' || a.edit_distance !== 0);
  const zeroMissMonth = recentRunIds.size >= 5 && !anyMiss;

  return {
    runCount,
    completedCount,
    windowDecided,
    windowApprovedUnedited,
    matchPct,
    cleanStreak,
    firstSolo,
    hundredRuns,
    zeroMissMonth,
  };
}

/** Honest "from graduating" line. Best-effort: when the window is full we can
 *  quote the approved-unedited deficit; otherwise we quote window progress. */
function gradLine(d: Derived): string {
  if (d.windowDecided >= PROMOTION_WINDOW) {
    const remaining = Math.max(0, PROMOTION_NEEDED - d.windowApprovedUnedited);
    if (remaining > 0) return `${remaining} clean ${remaining === 1 ? 'run' : 'runs'} from graduating`;
    return 'meets the graduation bar';
  }
  return `${d.windowDecided}/${PROMOTION_WINDOW} in the graduation window`;
}

/**
 * The honest fallback for the "what {name} has learned about you" block when no
 * Opus note is cached yet. Every branch is grounded in real derived signals —
 * eggs / no history get the watching line; some history gets a matchPct- or
 * streak-grounded line. Never fabricates a preference the data doesn't show.
 */
function learnedFallback(name: string, job: string, d: Derived): string {
  if (d.completedCount < NOTE_MIN_COMPLETED) {
    return 'Still watching how you work — first drafts are coming.';
  }
  if (d.matchPct !== null && d.matchPct >= 85) {
    return `You approve ${name}'s drafts almost untouched — it's matched how you ${job}.`;
  }
  if (d.cleanStreak >= 3) {
    return `${name} is on a ${d.cleanStreak}-run clean streak — it's getting your ${job} right.`;
  }
  if (d.matchPct !== null) {
    return `${name} is still learning your voice — you approve about ${d.matchPct}% of its drafts as written.`;
  }
  return `${name} is settling into ${job} — still learning what you'd change.`;
}

export default async function NibbinsPage() {
  let session;
  try {
    session = await appSession();
  } catch {
    redirect('/login');
  }
  const { supabase, accountId, user } = session;

  // RLS-scoped reads under the user's own session. One nibbins query (joined to
  // its spec, mirroring app/page.tsx + shop) and one runs query for the whole
  // account; approvals are joined to the account's runs. We aggregate per nibbin
  // in app code so each card reflects real run/approval history.
  const nowIso = new Date().toISOString();
  const [{ data: nibbinsData }, { data: runsData }, { data: approvalsData }, { data: trainingData }] =
    await Promise.all([
      supabase
        .from('nibbins')
        .select(
          'id, name, species, stage, status, paused_reason, palette, accessory, marking, stage_changed_at, hatched_at, learned_note, learned_note_runs, agent_specs(display_name, template_key, version)',
        )
        .eq('account_id', accountId)
        .eq('kind', 'specialist')
        .neq('status', 'sleeping')
        .order('hatched_at', { ascending: true }),
      supabase
        .from('runs')
        .select('id, nibbin_id, status, created_at')
        .eq('account_id', accountId)
        .order('created_at', { ascending: false }),
      supabase
        .from('approvals')
        .select('run_id, decision, edit_distance, decided_at')
        .eq('account_id', accountId)
        .order('decided_at', { ascending: false }),
      // §18.1: the open (unended, in-time-box) training window per agent, if any.
      // RLS scopes this to the account — a window can't leak across accounts.
      supabase
        .from('training_sessions')
        .select('nibbin_id, expires_at, max_runs, runs_used')
        .eq('account_id', accountId)
        .is('ended_at', null)
        .gt('expires_at', nowIso),
    ]);

  const nibbins = (nibbinsData ?? []) as unknown as NibbinRow[];
  const runs = (runsData ?? []) as RunRow[];
  const approvals = (approvalsData ?? []) as ApprovalRow[];
  const training = (trainingData ?? []) as TrainingRow[];

  // Index the open training window per nibbin (budget-bounded; only rows still
  // under budget surface as active).
  const trainingByNibbin = new Map<string, TrainingState>();
  for (const t of training) {
    const remaining = t.max_runs - t.runs_used;
    if (remaining <= 0) continue; // budget spent → not active
    trainingByNibbin.set(t.nibbin_id, {
      active: true,
      runsRemaining: remaining,
      expiresAtMs: new Date(t.expires_at).getTime(),
    });
  }

  // Index runs by nibbin, and approvals by the nibbin their run belongs to.
  const runsByNibbin = new Map<string, RunRow[]>();
  const runToNibbin = new Map<string, string>();
  for (const r of runs) {
    runToNibbin.set(r.id, r.nibbin_id);
    const list = runsByNibbin.get(r.nibbin_id) ?? [];
    list.push(r);
    runsByNibbin.set(r.nibbin_id, list);
  }
  const approvalsByNibbin = new Map<string, ApprovalRow[]>();
  for (const a of approvals) {
    const nibbinId = runToNibbin.get(a.run_id);
    if (!nibbinId) continue;
    const list = approvalsByNibbin.get(nibbinId) ?? [];
    list.push(a);
    approvalsByNibbin.set(nibbinId, list);
  }

  if (nibbins.length === 0) {
    return (
      <AppShell active="nibbins" title="Your Nibbins" email={user.email}>
        <div className={`${styles.agent} ${styles.empty}`} style={{ maxWidth: 520, margin: '0 auto' }}>
          <h2 className={styles.emptyTitle}>Your grove is quiet</h2>
          <p className={styles.emptyBody}>
            No Nibbins yet. Each one starts as an egg in Agent School — drafting everything for your
            yes until it earns its way to working on its own. Adopt your first from the shop.
          </p>
          <a className={`${styles.abtn} ${styles.abtnGo}`} href="/app/shop">
            Visit the Agent Shop →
          </a>
        </div>
      </AppShell>
    );
  }

  // Derive once per Nibbin; reused for the staleId pass and the render below.
  const derivedById = new Map<string, Derived>();
  for (const n of nibbins) {
    derivedById.set(
      n.id,
      derive(runsByNibbin.get(n.id) ?? [], approvalsByNibbin.get(n.id) ?? [], n.stage_changed_at),
    );
  }

  // Nibbins whose learned-note should be (re)generated in the background: enough
  // history for an honest line (≥ NOTE_MIN_COMPLETED completed runs) AND either
  // no cached note yet, or materially more run history since it was last written.
  const staleIds = nibbins
    .filter((n) => {
      const d = derivedById.get(n.id)!;
      if (d.completedCount < NOTE_MIN_COMPLETED) return false;
      return n.learned_note === null || d.runCount > n.learned_note_runs + NOTE_STALE_RUN_DELTA;
    })
    .map((n) => n.id);

  return (
    <AppShell active="nibbins" title="Your Nibbins" email={user.email}>
      <NoteRefresher staleIds={staleIds} action={refreshNibbinNote} />
      <div className={styles.pageHead}>
        <p className={styles.eyebrow}>Agent School</p>
        <h1 className={styles.h1}>Your nibbins</h1>
        <div className={styles.intro}>
          Every Nibbin climbs Agent School the same way — egg, student, senior, graduate — and trust is
          earned through verified accuracy, never time served. Streaks and badges below are read
          straight from real run history.{' '}
          <InfoTooltip content="Promotion is earned by a sustained track record of work you approve without edits — weighted by how much is at stake, and (for graduation) proven across several kinds of task." />
        </div>
      </div>

      <div className={styles.roster}>
        {nibbins.map((n) => {
          const d = derivedById.get(n.id)!;
          const rung = STAGE_RUNG[n.stage];
          const sprite = buildCreature({
            species: n.species as SpeciesName,
            stage: n.stage,
            color: n.palette ?? undefined,
            acc: (n.accessory ?? 'none') as Accessory,
            mark: (n.marking ?? 'none') as Marking,
            size: 58,
          });

          // Metric line — real numbers only.
          const metricParts: string[] = [];
          if (d.matchPct !== null) metricParts.push(`${d.matchPct}% match`);
          metricParts.push(`${d.runCount} ${d.runCount === 1 ? 'run' : 'runs'}`);
          if (n.stage !== 'grad') metricParts.push(gradLine(d));
          const metric = metricParts.join(' · ');

          // Badges: earned ones highlighted; a couple of unearned shown muted.
          const badges: [string, boolean][] = [
            ['First Solo', d.firstSolo],
            ['Zero-Miss Month', d.zeroMissMonth],
            ['100 Runs', d.hundredRuns],
          ];

          // "What {name} has learned about you" — the cached Opus note when
          // present, else an honest deterministic line grounded in real signals.
          // Stale/missing notes are regenerated in the background (NoteRefresher).
          const jobLower = jobOf(n).toLowerCase();
          const learnedText = n.learned_note ?? learnedFallback(n.name, jobLower, d);

          const specVersion = specVersionOf(n);

          return (
            <div className={styles.agent} key={n.id}>
              <div className={styles.top}>
                <span
                  className={styles.sprite}
                  aria-hidden="true"
                  dangerouslySetInnerHTML={{ __html: sprite }}
                />
                <div className={styles.id}>
                  <h4>{n.name}</h4>
                  <div className={styles.job}>{jobOf(n)}</div>
                </div>
                <span className={styles.idBadges}>
                  <span className={`${styles.stagepill} ${STAGE_PILL_CLASS[n.stage]}`}>
                    {STAGE_LABEL[n.stage]}
                  </span>
                  {specVersion !== null && (
                    <span className={styles.vBadge} title={`Spec version ${specVersion}`}>
                      v{specVersion}
                    </span>
                  )}
                </span>
              </div>

              <div className={styles.school}>
                <div className={styles.schoolLbl}>
                  <span>Agent School</span>
                  <b>{metric}</b>
                </div>
                <div className={styles.ladder}>
                  {[1, 2, 3, 4].map((i) => (
                    <div
                      key={i}
                      className={`${styles.rung} ${
                        i < rung ? styles.rungDone : i === rung ? styles.rungCur : ''
                      }`}
                    />
                  ))}
                </div>
                <div className={styles.ladderNames}>
                  <span>Egg</span>
                  <span>Student</span>
                  <span>Senior</span>
                  <span>Graduate</span>
                </div>
              </div>

              <div className={styles.badgeRow}>
                {d.cleanStreak >= 3 && (
                  <span className={styles.streak}>{d.cleanStreak}-run clean streak</span>
                )}
                {badges.map(([label, earned]) => (
                  <Tooltip key={label} content={earned ? 'Earned' : 'Not yet earned'}>
                    <span
                      className={`${styles.badge} ${earned ? styles.badgeEarned : ''}`}
                    >
                      {label}
                    </span>
                  </Tooltip>
                ))}
              </div>

              <div className={styles.learned}>
                <div className={styles.ll}>What {n.name} has learned about you</div>
                <p>{learnedText}</p>
              </div>

              <div className={styles.foot}>
                <span className={styles.footM}>
                  {n.stage === 'grad' ? (
                    <>Access: <b>acting on its own</b>{' '}
                      <InfoTooltip content="This Nibbin has graduated and can execute tasks without a draft step — you can step it back a grade any time." />
                    </>
                  ) : (
                    <>Access: <b>draft-only until graduation</b>{' '}
                      <InfoTooltip content="Every action is prepared as a draft and waits for your approval. Nothing is sent or executed until you say yes." />
                    </>
                  )}
                </span>
                <span style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                  {(n.stage === 'student' || n.stage === 'senior') && (
                    <TrainingToggle
                      nibbinId={n.id}
                      name={n.name}
                      state={trainingByNibbin.get(n.id) ?? { active: false }}
                    />
                  )}
                  {(n.stage === 'senior' || n.stage === 'grad') && (
                    <BackToDrafts nibbinId={n.id} name={n.name} />
                  )}
                  <NibbinEditor
                    nibbin={{
                      id: n.id,
                      name: n.name,
                      species: n.species,
                      stage: n.stage,
                      palette: n.palette,
                      accessory: n.accessory,
                      marking: n.marking,
                    }}
                  />
                  <RetuneDialog nibbinId={n.id} nibbinName={n.name} />
                  <NibbinControls
                    nibbinId={n.id}
                    name={n.name}
                    status={n.status}
                    pausedReason={n.paused_reason ?? null}
                  />
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </AppShell>
  );
}
