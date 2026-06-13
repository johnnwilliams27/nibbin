import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getStaff } from '../../lib/staff/session';
import { adminClient } from '../../lib/supabase/admin';
import { searchAccounts } from '../../lib/staff/search';
import styles from '../admin.module.css';

export const metadata: Metadata = { title: 'Accounts — Nibbin admin' };
export const dynamic = 'force-dynamic';

export default async function AccountsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const staff = await getStaff();
  if (!staff) redirect('/login');

  const { q } = await searchParams;
  const query = (q ?? '').trim();
  const admin = adminClient();
  const results = query ? await searchAccounts(admin, query) : [];

  if (query) {
    // Audit the search itself (§6.10 everything-audited). account_id is null —
    // a cross-account search belongs to no single account's member-visible log.
    await admin.rpc('staff_log_access', {
      p_staff_id: staff.staffId,
      p_action: 'account.searched',
      p_account_id: null,
      p_meta: { query, results: results.length },
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

      {query && (
        <p className={styles.muted}>
          {results.length} {results.length === 1 ? 'result' : 'results'} for &ldquo;{query}&rdquo;
        </p>
      )}

      <ul className={styles.results}>
        {results.map((a) => (
          <li key={a.id} className={styles.resultRow}>
            <a href={`/accounts/${a.id}`}>{a.name}</a>
            <span className={styles.mono}>{a.id}</span>
          </li>
        ))}
      </ul>
    </main>
  );
}
