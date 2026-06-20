import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getStaff } from '../../lib/staff/session';
import { adminClient } from '../../lib/supabase/admin';
import { inviteFromWaitlist } from './actions';
import styles from '../admin.module.css';

export const metadata: Metadata = { title: 'Waitlist — Nibbin admin' };
export const dynamic = 'force-dynamic';

interface WaitlistRow {
  email: string;
  status: 'pending' | 'confirmed';
  source: string | null;
  created_at: string;
  confirmed_at: string | null;
  invited_at: string | null;
}

function fmt(ts: string | null): string {
  if (!ts) return '—';
  return new Date(ts).toISOString().slice(0, 16).replace('T', ' ') + ' UTC';
}

const NOTICES: Record<string, { cls: 'notice' | 'error'; msg: string }> = {
  invited: { cls: 'notice', msg: 'Invite sent — the account-creation email is on its way.' },
  invite_failed: { cls: 'error', msg: 'Invite failed. It’s been logged; give it another try in a moment.' },
  invite_unconfigured: { cls: 'error', msg: 'Invites aren’t configured yet (INTERNAL_API_SECRET missing on this app).' },
};

export default async function WaitlistPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; notice?: string }>;
}) {
  const staff = await getStaff();
  if (!staff) redirect('/login');

  const { status, notice } = await searchParams;
  const filter: 'all' | 'pending' | 'confirmed' =
    status === 'pending' || status === 'confirmed' ? status : 'all';
  const admin = adminClient();

  // Service role bypasses RLS (waitlist is staff-only, like email_suppressions).
  let q = admin
    .from('waitlist')
    .select('email, status, source, created_at, confirmed_at, invited_at')
    .order('created_at', { ascending: false })
    .limit(1000);
  if (filter !== 'all') q = q.eq('status', filter);
  const { data, error } = await q;
  const rows = (data ?? []) as WaitlistRow[];

  // Totals independent of the active filter.
  const { count: total } = await admin.from('waitlist').select('email', { count: 'exact', head: true });
  const { count: confirmed } = await admin
    .from('waitlist')
    .select('email', { count: 'exact', head: true })
    .eq('status', 'confirmed');
  const pending = (total ?? 0) - (confirmed ?? 0);

  // §6.10 everything-audited: staff reading user emails is logged. account_id is
  // null — the waitlist belongs to no single account.
  await admin.rpc('staff_log_access', {
    p_staff_id: staff.staffId,
    p_action: 'waitlist.viewed',
    p_account_id: null,
    p_meta: { filter, rows: rows.length },
  });

  return (
    <main className={styles.page}>
      <header className={styles.topbar}>
        <span className={styles.nav}>
          <span className={styles.brand}>Nibbin · staff</span>
          <a className={styles.navLink} href="/accounts">
            Accounts
          </a>
          <a className={`${styles.navLink} ${styles.navActive}`} href="/waitlist">
            Waitlist
          </a>
          <a className={styles.navLink} href="/scoreboard">
            Model performance
          </a>
          <a className={styles.navLink} href="/analytics">
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

      <h1 className={styles.h1}>Founding Grove waitlist</h1>

      {notice && NOTICES[notice] && (
        <p className={styles[NOTICES[notice].cls]}>{NOTICES[notice].msg}</p>
      )}

      <div className={styles.statsRow}>
        <div className={styles.stat}>
          <span className={styles.statLabel}>Total</span>
          <span className={styles.statValue}>{total ?? 0}</span>
        </div>
        <div className={styles.stat}>
          <span className={styles.statLabel}>Confirmed</span>
          <span className={styles.statValue}>{confirmed ?? 0}</span>
        </div>
        <div className={styles.stat}>
          <span className={styles.statLabel}>Pending</span>
          <span className={styles.statValue}>{pending}</span>
        </div>
      </div>

      <form method="get" className={styles.search}>
        <select className={styles.select} name="status" defaultValue={filter} aria-label="Filter by status">
          <option value="all">All</option>
          <option value="confirmed">Confirmed</option>
          <option value="pending">Pending</option>
        </select>
        <button className={styles.secondary} type="submit">
          Filter
        </button>
      </form>

      {error ? (
        <p className={styles.error}>Couldn’t load the waitlist — {error.message}</p>
      ) : rows.length === 0 ? (
        <p className={styles.muted}>No one on the waitlist yet.</p>
      ) : (
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Email</th>
              <th>Status</th>
              <th>Source</th>
              <th>Signed up</th>
              <th>Confirmed</th>
              <th>Invite</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.email}>
                <td className={styles.mono}>{r.email}</td>
                <td>{r.status}</td>
                <td>{r.source ?? '—'}</td>
                <td className={styles.mono}>{fmt(r.created_at)}</td>
                <td className={styles.mono}>{fmt(r.confirmed_at)}</td>
                <td>
                  {r.invited_at ? (
                    <span className={styles.muted}>Invited · {fmt(r.invited_at)}</span>
                  ) : (
                    <form action={inviteFromWaitlist} className={styles.inlineForm}>
                      <input type="hidden" name="email" value={r.email} />
                      <button className={styles.linkBtn} type="submit">
                        Invite
                      </button>
                    </form>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  );
}
