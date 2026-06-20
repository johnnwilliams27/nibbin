import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getStaff } from '../../lib/staff/session';
import { adminClient } from '../../lib/supabase/admin';
import {
  loadAnalyticsOverview,
  loadAnalyticsDaily,
  loadDesktopDownloads,
  approvalRate,
  type AnalyticsOverview,
  type AnalyticsDay,
  type DesktopDownloads,
} from '../../lib/analytics/read';
import styles from '../admin.module.css';

export const metadata: Metadata = { title: 'Analytics — Nibbin admin' };
export const dynamic = 'force-dynamic';

function pct(r: number | null): string {
  return r === null ? '—' : `${(r * 100).toFixed(0)}%`;
}

function n(v: number): string {
  return v.toLocaleString('en-US');
}

export default async function AnalyticsPage() {
  const staff = await getStaff();
  if (!staff) redirect('/login');

  const admin = adminClient();

  // RPC loaders: throw on failure (matches scoreboard behaviour).
  // Desktop loader: never throws (self-fails-soft).
  const [overview, daily, desktop] = await Promise.all([
    loadAnalyticsOverview(admin) as Promise<AnalyticsOverview>,
    loadAnalyticsDaily(admin, 30) as Promise<AnalyticsDay[]>,
    loadDesktopDownloads() as Promise<DesktopDownloads>,
  ]);

  await admin.rpc('staff_log_access', {
    p_staff_id: staff.staffId,
    p_action: 'analytics.view',
    p_account_id: null,
    p_meta: { daily_rows: daily.length },
  });

  const rate = approvalRate(overview);

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
          <a className={styles.navLink} href="/scoreboard">
            Model performance
          </a>
          <a className={`${styles.navLink} ${styles.navActive}`} href="/analytics">
            Analytics
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

      <h1 className={styles.h1}>Analytics</h1>
      <p className={styles.muted}>Staff operational metrics. Aggregate counts only — no per-user content.</p>

      {/* Waitlist */}
      <h2 className={styles.h2}>Waitlist</h2>
      <div className={styles.statsRow}>
        <div className={styles.stat}>
          <span className={styles.statLabel}>Total</span>
          <span className={styles.statValue}>{n(overview.waitlist_total)}</span>
        </div>
        <div className={styles.stat}>
          <span className={styles.statLabel}>Confirmed</span>
          <span className={styles.statValue}>{n(overview.waitlist_confirmed)}</span>
        </div>
      </div>

      {/* Accounts */}
      <h2 className={styles.h2}>Accounts</h2>
      <div className={styles.statsRow}>
        <div className={styles.stat}>
          <span className={styles.statLabel}>Total</span>
          <span className={styles.statValue}>{n(overview.accounts_total)}</span>
        </div>
        <div className={styles.stat}>
          <span className={styles.statLabel}>New (7d)</span>
          <span className={styles.statValue}>{n(overview.accounts_7d)}</span>
        </div>
        <div className={styles.stat}>
          <span className={styles.statLabel}>New (30d)</span>
          <span className={styles.statValue}>{n(overview.accounts_30d)}</span>
        </div>
      </div>

      {/* Active accounts */}
      <h2 className={styles.h2}>Active accounts</h2>
      <div className={styles.statsRow}>
        <div className={styles.stat}>
          <span className={styles.statLabel}>DAU (1d)</span>
          <span className={styles.statValue}>{n(overview.active_1d)}</span>
        </div>
        <div className={styles.stat}>
          <span className={styles.statLabel}>WAU (7d)</span>
          <span className={styles.statValue}>{n(overview.active_7d)}</span>
        </div>
        <div className={styles.stat}>
          <span className={styles.statLabel}>MAU (30d)</span>
          <span className={styles.statValue}>{n(overview.active_30d)}</span>
        </div>
      </div>

      {/* Runs */}
      <h2 className={styles.h2}>Runs</h2>
      <div className={styles.statsRow}>
        <div className={styles.stat}>
          <span className={styles.statLabel}>Total</span>
          <span className={styles.statValue}>{n(overview.runs_total)}</span>
        </div>
        <div className={styles.stat}>
          <span className={styles.statLabel}>Last 30d</span>
          <span className={styles.statValue}>{n(overview.runs_30d)}</span>
        </div>
      </div>

      {/* Approval mix (30d) */}
      <h2 className={styles.h2}>Approval mix (30d)</h2>
      <div className={styles.statsRow}>
        <div className={styles.stat}>
          <span className={styles.statLabel}>Decided</span>
          <span className={styles.statValue}>{n(overview.decided_30d)}</span>
        </div>
        <div className={styles.stat}>
          <span className={styles.statLabel}>Approved unedited</span>
          <span className={styles.statValue}>{n(overview.approved_unedited_30d)}</span>
        </div>
        <div className={styles.stat}>
          <span className={styles.statLabel}>Edited</span>
          <span className={styles.statValue}>{n(overview.edited_30d)}</span>
        </div>
        <div className={styles.stat}>
          <span className={styles.statLabel}>Rejected</span>
          <span className={styles.statValue}>{n(overview.rejected_30d)}</span>
        </div>
        <div className={styles.stat}>
          <span className={styles.statLabel}>Approval rate</span>
          <span className={styles.statValue}>{pct(rate)}</span>
        </div>
      </div>

      {/* Nibbins by stage */}
      <h2 className={styles.h2}>Nibbins by stage</h2>
      <div className={styles.statsRow}>
        <div className={styles.stat}>
          <span className={styles.statLabel}>Total</span>
          <span className={styles.statValue}>{n(overview.nibbins_total)}</span>
        </div>
        <div className={styles.stat}>
          <span className={styles.statLabel}>Egg</span>
          <span className={styles.statValue}>{n(overview.nibbins_egg)}</span>
        </div>
        <div className={styles.stat}>
          <span className={styles.statLabel}>Student</span>
          <span className={styles.statValue}>{n(overview.nibbins_student)}</span>
        </div>
        <div className={styles.stat}>
          <span className={styles.statLabel}>Senior</span>
          <span className={styles.statValue}>{n(overview.nibbins_senior)}</span>
        </div>
        <div className={styles.stat}>
          <span className={styles.statLabel}>Grad</span>
          <span className={styles.statValue}>{n(overview.nibbins_grad)}</span>
        </div>
      </div>

      {/* Daily trend table */}
      <h2 className={styles.h2}>Daily trend (last 30d)</h2>
      {daily.length === 0 ? (
        <p className={styles.muted}>No daily data recorded.</p>
      ) : (
        <section className={styles.panel}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Day</th>
                <th>Accounts created</th>
                <th>Runs</th>
                <th>Approvals</th>
                <th>Active accounts</th>
              </tr>
            </thead>
            <tbody>
              {daily.map((row) => (
                <tr key={row.day}>
                  <td className={styles.mono}>{row.day}</td>
                  <td className={styles.mono}>{n(row.accounts_created)}</td>
                  <td className={styles.mono}>{n(row.runs)}</td>
                  <td className={styles.mono}>{n(row.approvals)}</td>
                  <td className={styles.mono}>{n(row.active_accounts)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {/* Desktop downloads */}
      <h2 className={styles.h2}>Desktop downloads</h2>
      {!desktop.available ? (
        <p className={styles.muted}>GitHub release stats unavailable.</p>
      ) : (
        <>
          <p className={styles.muted}>
            Cumulative installer download counts from GitHub releases (Windows = .msi + .exe combined).
          </p>
          <div className={styles.statsRow}>
            <div className={styles.stat}>
              <span className={styles.statLabel}>macOS (.dmg)</span>
              <span className={styles.statValue}>{n(desktop.byPlatform.macos)}</span>
            </div>
            <div className={styles.stat}>
              <span className={styles.statLabel}>Windows (.msi + .exe)</span>
              <span className={styles.statValue}>{n(desktop.byPlatform.windows)}</span>
            </div>
          </div>
          {desktop.releases.length > 0 && (
            <section className={styles.panel}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>Release</th>
                    <th>Downloads</th>
                  </tr>
                </thead>
                <tbody>
                  {desktop.releases.map((r) => (
                    <tr key={r.tag}>
                      <td className={styles.mono}>{r.tag}</td>
                      <td className={styles.mono}>{n(r.total)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          )}
        </>
      )}
    </main>
  );
}
