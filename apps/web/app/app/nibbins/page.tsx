import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { buildCreature, type Accessory, type Marking, type SpeciesName, type Stage } from '@nibbin/creatures';
import { appSession } from '../../../lib/auth/app-session';
import { AppShell } from '../../../components/shell/AppShell';
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
}
interface NibbinRow {
  id: string;
  name: string;
  species: string;
  stage: Stage;
  status: string;
  palette: string | null;
  accessory: string | null;
  marking: string | null;
  stage_changed_at: string;
  hatched_at: string;
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

function specOf(n: NibbinRow): SpecRow | null {
  const s = n.agent_specs;
  return Array.isArray(s) ? (s[0] ?? null) : s;
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
  const [{ data: nibbinsData }, { data: runsData }, { data: approvalsData }] = await Promise.all([
    supabase
      .from('nibbins')
      .select(
        'id, name, species, stage, status, palette, accessory, marking, stage_changed_at, hatched_at, agent_specs(display_name, template_key)',
      )
      .eq('account_id', accountId)
      .eq('kind', 'specialist')
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
  ]);

  const nibbins = (nibbinsData ?? []) as unknown as NibbinRow[];
  const runs = (runsData ?? []) as RunRow[];
  const approvals = (approvalsData ?? []) as ApprovalRow[];

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

  return (
    <AppShell active="nibbins" title="Your Nibbins" email={user.email}>
      <p className={styles.intro}>
        Every Nibbin climbs Agent School the same way — egg, student, senior, graduate — and trust is
        earned through verified accuracy, never time served. Streaks and badges below are read
        straight from real run history.
      </p>

      <div className={styles.roster}>
        {nibbins.map((n) => {
          const d = derive(
            runsByNibbin.get(n.id) ?? [],
            approvalsByNibbin.get(n.id) ?? [],
            n.stage_changed_at,
          );
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
                <span className={`${styles.stagepill} ${STAGE_PILL_CLASS[n.stage]}`}>
                  {STAGE_LABEL[n.stage]}
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
                  <span
                    key={label}
                    className={`${styles.badge} ${earned ? styles.badgeEarned : ''}`}
                    title={earned ? 'Earned' : 'Not yet earned'}
                  >
                    {label}
                  </span>
                ))}
              </div>

              <div className={styles.foot}>
                <span className={styles.footM}>
                  {n.stage === 'grad' ? (
                    <>Access: <b>acting on its own</b></>
                  ) : (
                    <>Access: <b>draft-only until graduation</b></>
                  )}
                </span>
                <a className={styles.abtn} href="/app/shop">
                  Adopt more →
                </a>
              </div>
            </div>
          );
        })}
      </div>
    </AppShell>
  );
}
