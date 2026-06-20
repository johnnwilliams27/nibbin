import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getStaff } from '../../lib/staff/session';
import { adminClient } from '../../lib/supabase/admin';
import { searchAccounts, listAccounts } from '../../lib/staff/search';
import styles from '../admin.module.css';

export const metadata: Metadata = { title: 'Accounts — Nibbin admin' };
export const dynamic = 'force-dynamic';

function fmt(ts: string): string {
  return new Date(ts).toISOString().slice(0, 10);
}

function fmtSpend(usd: number | null): string {
  if (usd == null) return '—';
  if (usd < 0.01) return '<$0.01';
  return `$${usd.toFixed(2)}`;
}

export default async function AccountsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; tier?: string; status?: string; from?: string; to?: string }>;
}) {
  const staff = await getStaff();
  if (!staff) redirect('/login');

  const { q, tier, status, from, to } = await searchParams;
  const query = (q ?? '').trim();
  const admin = adminClient();

  const isSearch = query.length > 0;

  // Search overrides list when q is set.
  const searchResults = isSearch ? await searchAccounts(admin, query) : [];
  const listRows = !isSearch
    ? await listAccounts(admin, {
        tier: tier || undefined,
        status: status || undefined,
        from: from || undefined,
        to: to || undefined,
      })
    : [];

  if (isSearch) {
    await admin.rpc('staff_log_access', {
      p_staff_id: staff.staffId,
      p_action: 'account.searched',
      p_account_id: null,
      p_meta: { query, results: searchResults.length },
    });
  }

  return (
    <main className={styles.page}>
      <header className={styles.topbar}>
        <span className={styles.nav}>
          <span className={styles.brand}>Nibbin · staff</span>
          <a className={`${styles.navLink} ${styles.navActive}`} href="/accounts">
            Accounts
          </a>
          <a className={styles.navLink} href="/waitlist">
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

      <h1 className={styles.h1}>Accounts</h1>

      {/* Search box */}
      <form method="get" className={styles.search}>
        <input
          className={styles.input}
          name="q"
          defaultValue={query}
          placeholder="Search by account id, member email, or name"
          aria-label="Search accounts"
        />
        <button className={styles.primary} type="submit">
          Search
        </button>
      </form>

      {/* Filters (only shown when not in search mode) */}
      {!isSearch && (
        <form method="get" className={styles.filterRow}>
          <select
            className={styles.select}
            name="tier"
            defaultValue={tier ?? ''}
            aria-label="Filter by tier"
          >
            <option value="">All tiers</option>
            <option value="hatchling">Hatchling</option>
            <option value="grove">Grove</option>
            <option value="canopy">Canopy</option>
          </select>
          <select
            className={styles.select}
            name="status"
            defaultValue={status ?? ''}
            aria-label="Filter by subscription status"
          >
            <option value="">All statuses</option>
            <option value="active">Active</option>
            <option value="trialing">Trialing</option>
            <option value="past_due">Past due</option>
            <option value="canceled">Canceled</option>
          </select>
          <input
            className={styles.input}
            type="date"
            name="from"
            defaultValue={from ?? ''}
            aria-label="Created from date"
            style={{ flex: '0 0 auto', width: '140px' }}
          />
          <span className={styles.muted}>–</span>
          <input
            className={styles.input}
            type="date"
            name="to"
            defaultValue={to ?? ''}
            aria-label="Created to date"
            style={{ flex: '0 0 auto', width: '140px' }}
          />
          <button className={styles.secondary} type="submit">
            Filter
          </button>
          <a className={styles.muted} href="/accounts" style={{ alignSelf: 'center' }}>
            Clear
          </a>
        </form>
      )}

      {/* Search results */}
      {isSearch && (
        <>
          <p className={styles.muted}>
            {searchResults.length} {searchResults.length === 1 ? 'result' : 'results'} for &ldquo;
            {query}&rdquo;
          </p>
          <ul className={styles.results}>
            {searchResults.map((a) => (
              <li key={a.id} className={styles.resultRow}>
                <a href={`/accounts/${a.id}`}>{a.name}</a>
                <span className={styles.mono}>{a.id}</span>
              </li>
            ))}
          </ul>
        </>
      )}

      {/* Filterable list */}
      {!isSearch && (
        <>
          <p className={styles.muted}>
            {listRows.length === 100 ? 'Showing first 100' : `${listRows.length} accounts`}
            {tier || status || from || to ? ' (filtered)' : ''}
          </p>
          {listRows.length === 0 ? (
            <p className={styles.muted}>No accounts match the current filters.</p>
          ) : (
            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Tier</th>
                    <th>Status</th>
                    <th>Members</th>
                    <th>Created</th>
                    <th>30d spend</th>
                  </tr>
                </thead>
                <tbody>
                  {listRows.map((r) => (
                    <tr key={r.id}>
                      <td>
                        <a href={`/accounts/${r.id}`}>{r.name}</a>
                        <br />
                        <span className={styles.mono}>{r.id}</span>
                      </td>
                      <td>{r.tier ?? '—'}</td>
                      <td>{r.sub_status ?? '—'}</td>
                      <td>{r.member_count}</td>
                      <td className={styles.mono}>{fmt(r.created_at)}</td>
                      <td className={styles.mono}>{fmtSpend(r.spend_usd)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </main>
  );
}
