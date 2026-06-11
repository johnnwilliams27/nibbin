import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { getStaff, canAdjustCredits, canImpersonate } from '../../../lib/staff/session';
import { adminClient } from '../../../lib/supabase/admin';
import { adjustCredits, startImpersonation } from './actions';
import styles from '../../admin.module.css';

export const metadata: Metadata = { title: 'Account — Nibbin admin' };
export const dynamic = 'force-dynamic';

const NOTICES: Record<string, string> = {
  adjusted: 'Credit adjustment applied and recorded in the audit log.',
  impersonating: 'Read-only impersonation session started. It is visible in this account’s audit log.',
};
const ERRORS: Record<string, string> = {
  adjust: 'The adjustment could not be applied. Check the amount and reason.',
  impersonate: 'A written reason is required to start impersonation.',
};

export default async function AccountDetail({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ done?: string; error?: string }>;
}) {
  const staff = await getStaff();
  if (!staff) redirect('/login');

  const { id } = await params;
  const { done, error } = await searchParams;
  const admin = adminClient();

  const { data: account } = await admin
    .from('accounts')
    .select('id, name, created_at')
    .eq('id', id)
    .maybeSingle();
  if (!account) notFound();

  // Everything audited (§6.10): record the staff view — the insider-threat
  // control. account_id is set so it shows in the account's own audit log.
  await admin.rpc('staff_log_access', {
    p_staff_id: staff.staffId,
    p_action: 'account.viewed',
    p_account_id: id,
    p_meta: {},
  });

  const { data: sub } = await admin
    .from('subscriptions')
    .select('tier, status, period_end')
    .eq('account_id', id)
    .maybeSingle();
  const { data: bal } = await admin
    .from('credit_balances')
    .select('balance')
    .eq('account_id', id)
    .maybeSingle();
  const { data: ledger } = await admin
    .from('credit_ledger')
    .select('created_at, delta, reason, source_id')
    .eq('account_id', id)
    .order('created_at', { ascending: false })
    .limit(10);
  const { data: audit } = await admin
    .from('audit_log')
    .select('at, actor, actor_id, action, meta')
    .eq('account_id', id)
    .order('at', { ascending: false })
    .limit(10);

  const credits = bal?.balance ?? 0;

  return (
    <main className={styles.page}>
      <header className={styles.topbar}>
        <span className={styles.brand}>
          <a href="/accounts">Nibbin · staff</a>
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

      <h1 className={styles.h1}>{account.name}</h1>
      <p className={styles.mono}>{account.id}</p>

      {done && NOTICES[done] && <p className={styles.notice}>{NOTICES[done]}</p>}
      {error && ERRORS[error] && (
        <p className={styles.error} role="alert">
          {ERRORS[error]}
        </p>
      )}

      <section className={styles.statsRow}>
        <div className={styles.stat}>
          <span className={styles.statLabel}>Plan</span>
          <span className={styles.statValue}>{sub?.tier ?? '—'}</span>
        </div>
        <div className={styles.stat}>
          <span className={styles.statLabel}>Status</span>
          <span className={styles.statValue}>{sub?.status ?? '—'}</span>
        </div>
        <div className={styles.stat}>
          <span className={styles.statLabel}>Credits</span>
          <span className={styles.statValue}>{credits}</span>
        </div>
      </section>

      {canAdjustCredits(staff.role) && (
        <section className={styles.panel}>
          <h2 className={styles.h2}>Adjust credits</h2>
          <form action={adjustCredits} className={styles.adjustForm}>
            <input type="hidden" name="accountId" value={account.id} />
            <select name="direction" className={styles.select} aria-label="Direction">
              <option value="grant">Grant (+)</option>
              <option value="clawback">Clawback (−)</option>
            </select>
            <input
              className={styles.input}
              name="amount"
              inputMode="numeric"
              pattern="[0-9]*"
              placeholder="Amount"
              aria-label="Amount"
              required
            />
            <input
              className={styles.input}
              name="reason"
              placeholder="Reason (required, audited)"
              aria-label="Reason"
              required
            />
            <button className={styles.primary} type="submit">
              Apply
            </button>
          </form>
        </section>
      )}

      {canImpersonate(staff.role) && (
        <section className={styles.panel}>
          <h2 className={styles.h2}>Impersonate (read-only)</h2>
          <form action={startImpersonation} className={styles.adjustForm}>
            <input type="hidden" name="accountId" value={account.id} />
            <input
              className={styles.input}
              name="reason"
              placeholder="Reason (required, shown in the account’s audit log)"
              aria-label="Impersonation reason"
              required
            />
            <button className={styles.secondary} type="submit">
              Start read session
            </button>
          </form>
        </section>
      )}

      <section className={styles.panel}>
        <h2 className={styles.h2}>Recent credit ledger</h2>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>When</th>
              <th>Δ</th>
              <th>Reason</th>
            </tr>
          </thead>
          <tbody>
            {(ledger ?? []).map((r, i) => (
              <tr key={i}>
                <td className={styles.mono}>{new Date(r.created_at).toISOString().slice(0, 19)}</td>
                <td>{r.delta}</td>
                <td>{r.reason}</td>
              </tr>
            ))}
            {(ledger ?? []).length === 0 && (
              <tr>
                <td colSpan={3} className={styles.muted}>
                  No ledger entries.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </section>

      <section className={styles.panel}>
        <h2 className={styles.h2}>Recent audit log</h2>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>When</th>
              <th>Actor</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {(audit ?? []).map((r, i) => (
              <tr key={i}>
                <td className={styles.mono}>{new Date(r.at).toISOString().slice(0, 19)}</td>
                <td>
                  {r.actor}
                  {r.actor_id ? ` · ${r.actor_id}` : ''}
                </td>
                <td>{r.action}</td>
              </tr>
            ))}
            {(audit ?? []).length === 0 && (
              <tr>
                <td colSpan={3} className={styles.muted}>
                  No audit entries.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </section>
    </main>
  );
}
