import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getStaff } from '../../lib/staff/session';
import { adminClient } from '../../lib/supabase/admin';
import { loadScoreboard, type ScoreboardRow } from '../../lib/scoreboard/read';
import styles from '../admin.module.css';

export const metadata: Metadata = { title: 'Model performance — Nibbin admin' };
export const dynamic = 'force-dynamic';

/**
 * Staff-gated, READ-ONLY model-performance scoreboard (routing-reinforcement
 * Slice A §4). Pure observability — it changes nothing about routing; it shows
 * per-(model × task) quality/outcome/cost over the last 30 days so the team's
 * manual, eval-gated model swaps are informed and provider model churn (a model
 * silently degrading) is visible. No actions, no forms.
 */

function pct(rate: number | null): string {
  return rate === null ? '—' : `${(rate * 100).toFixed(0)}%`;
}

function dollars(microusd: number | null): string {
  if (microusd === null) return '—';
  return `$${(microusd / 1_000_000).toFixed(4)}`;
}

function relTime(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toISOString().slice(0, 10);
}

export default async function ScoreboardPage() {
  const staff = await getStaff();
  if (!staff) redirect('/login');

  const admin = adminClient();
  const rows = await loadScoreboard(admin);

  // Audit the cross-account telemetry view (§6.10 everything-audited). It is
  // cross-account model telemetry, not one account's data → account_id null.
  await admin.rpc('staff_log_access', {
    p_staff_id: staff.staffId,
    p_action: 'model_performance.viewed',
    p_account_id: null,
    p_meta: { rows: rows.length },
  });

  // Group by task; within a task, highest-volume model first.
  const byTask = new Map<string, ScoreboardRow[]>();
  for (const r of rows) {
    const list = byTask.get(r.task) ?? [];
    list.push(r);
    byTask.set(r.task, list);
  }
  const tasks = [...byTask.keys()].sort();
  for (const t of tasks) byTask.get(t)!.sort((a, b) => b.calls - a.calls);

  const totalCalls = rows.reduce((s, r) => s + r.calls, 0);
  const totalCost = rows.reduce((s, r) => s + (r.total_cost_microusd ?? 0), 0);

  return (
    <main className={styles.page}>
      <header className={styles.topbar}>
        <span className={styles.nav}>
          <span className={styles.brand}>Nibbin · staff</span>
          <a className={styles.navLink} href="/accounts">
            Accounts
          </a>
          <a className={styles.navLink} href="/waitlist">
            Waitlist
          </a>
          <a className={`${styles.navLink} ${styles.navActive}`} href="/scoreboard">
            Model performance
          </a>
        </span>
        <span className={styles.who}>
          {staff.email} · {staff.role}
          <form action="/auth/signout" method="post" className={styles.inlineForm}>
            <button className={styles.linkBtn} type="submit">
              Sign out
            </button>
          </form>
        </span>
      </header>

      <h1 className={styles.h1}>Model performance</h1>
      <p className={styles.muted}>
        Per-function model quality, outcomes, and cost over the last 30 days. Read-only telemetry to
        inform manual, eval-gated model choices — this view changes nothing about routing. Quality
        rates cover only calls a person decided on (approval surfaces); outcome and cost cover all
        calls.
      </p>

      <section className={styles.statsRow}>
        <span className={styles.stat}>
          <span className={styles.statLabel}>Calls (30d)</span>
          <span className={styles.statValue}>{totalCalls}</span>
        </span>
        <span className={styles.stat}>
          <span className={styles.statLabel}>Total cost</span>
          <span className={styles.statValue}>{dollars(totalCost)}</span>
        </span>
        <span className={styles.stat}>
          <span className={styles.statLabel}>Model × task rows</span>
          <span className={styles.statValue}>{rows.length}</span>
        </span>
      </section>

      {rows.length === 0 ? (
        <p className={styles.muted}>No model calls recorded in the last 30 days.</p>
      ) : (
        tasks.map((task) => (
          <section key={task} className={styles.panel}>
            <h2 className={styles.h2}>{task}</h2>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Model</th>
                  <th>Tier</th>
                  <th>Calls</th>
                  <th>Decided</th>
                  <th>Approved unedited</th>
                  <th>Edited</th>
                  <th>Rejected</th>
                  <th>Avg edit dist.</th>
                  <th>Refusal</th>
                  <th>Error</th>
                  <th>Degraded</th>
                  <th>Avg cost</th>
                  <th>Total cost</th>
                  <th>Avg latency</th>
                  <th>Last call</th>
                </tr>
              </thead>
              <tbody>
                {byTask.get(task)!.map((r) => (
                  <tr key={`${r.model}:${r.tier}`}>
                    <td className={styles.mono}>{r.model}</td>
                    <td className={styles.mono}>{r.tier}</td>
                    <td className={styles.mono}>{r.calls}</td>
                    <td className={styles.mono}>{r.decided_calls}</td>
                    <td className={styles.mono}>{pct(r.approvedUneditedRate)}</td>
                    <td className={styles.mono}>{pct(r.editedRate)}</td>
                    <td className={styles.mono}>{pct(r.rejectedRate)}</td>
                    <td className={styles.mono}>
                      {r.avg_edit_distance === null ? '—' : r.avg_edit_distance.toFixed(1)}
                    </td>
                    <td className={styles.mono}>{pct(r.refusalRate)}</td>
                    <td className={styles.mono}>{pct(r.errorRate)}</td>
                    <td className={styles.mono}>{pct(r.degradationRate)}</td>
                    <td className={styles.mono}>{dollars(r.avg_cost_microusd)}</td>
                    <td className={styles.mono}>{dollars(r.total_cost_microusd)}</td>
                    <td className={styles.mono}>{r.avg_latency_ms === null ? '—' : `${r.avg_latency_ms}ms`}</td>
                    <td className={styles.mono}>{relTime(r.last_call_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        ))
      )}
    </main>
  );
}
