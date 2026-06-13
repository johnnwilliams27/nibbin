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

// §6.12 activation funnel milestones (those currently emitted), in order.
const FUNNEL: ReadonlyArray<{ name: string; label: string }> = [
  { name: 'account_created', label: 'created' },
  { name: 'scan_completed', label: 'scanned' },
  { name: 'nibbin_adopted', label: 'adopted' },
  { name: 'first_draft_approved', label: 'first approval' },
];

function fmtDuration(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

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
  // §6.10 unit economics: 30-day model COGS for this account (M6.5)
  const { data: cogsRows } = await admin.rpc('account_model_cogs', { p_account: id, p_days: 30 });
  const cogs = Array.isArray(cogsRows) ? (cogsRows[0] ?? null) : null;

  // §6.12 / TTFAD: the account's product events → activation funnel + the time
  // from account creation to the first approved draft (the north-star metric).
  const { data: pevents } = await admin
    .from('product_events')
    .select('name, at')
    .eq('account_id', id)
    .order('at', { ascending: true })
    .limit(500);
  const events = (pevents ?? []) as { name: string; at: string }[];
  const fired = new Set(events.map((e) => e.name));
  const firstApprovedAt = events.find((e) => e.name === 'first_draft_approved')?.at ?? null;
  const ttfadMs = firstApprovedAt
    ? new Date(firstApprovedAt).getTime() - new Date(account.created_at).getTime()
    : null;

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

      <section className={styles.panel}>
        <h2 className={styles.h2}>Model COGS — last 30 days</h2>
        {cogs && Number(cogs.calls) > 0 ? (
          <section className={styles.statsRow}>
            <div className={styles.stat}>
              <span className={styles.statLabel}>Cost</span>
              <span className={styles.statValue}>${(Number(cogs.cost_microusd) / 1_000_000).toFixed(4)}</span>
            </div>
            <div className={styles.stat}>
              <span className={styles.statLabel}>Model calls</span>
              <span className={styles.statValue}>{Number(cogs.calls)}</span>
            </div>
            <div className={styles.stat}>
              <span className={styles.statLabel}>Cache hit rate</span>
              <span className={styles.statValue}>
                {(() => {
                  const read = Number(cogs.cache_read_tokens);
                  const promptTokens = Number(cogs.input_tokens) + Number(cogs.cache_write_tokens) + read;
                  return promptTokens === 0 ? '—' : `${Math.round((read / promptTokens) * 100)}%`;
                })()}
              </span>
            </div>
            <div className={styles.stat}>
              <span className={styles.statLabel}>Tokens (in / out)</span>
              <span className={styles.statValue}>
                {Number(cogs.input_tokens) + Number(cogs.cache_write_tokens) + Number(cogs.cache_read_tokens)} /{' '}
                {Number(cogs.output_tokens)}
              </span>
            </div>
          </section>
        ) : (
          <p className={styles.muted}>No model calls in the window — this account is running on the scripted/deterministic floor.</p>
        )}
      </section>

      <section className={styles.panel}>
        <h2 className={styles.h2}>Activation &amp; TTFAD</h2>
        <section className={styles.statsRow}>
          <div className={styles.stat}>
            <span className={styles.statLabel}>Account created</span>
            <span className={styles.statValue}>{new Date(account.created_at).toISOString().slice(0, 16).replace('T', ' ')}</span>
          </div>
          <div className={styles.stat}>
            <span className={styles.statLabel}>First approved draft</span>
            <span className={styles.statValue}>
              {firstApprovedAt ? new Date(firstApprovedAt).toISOString().slice(0, 16).replace('T', ' ') : '—'}
            </span>
          </div>
          <div className={styles.stat}>
            <span className={styles.statLabel}>TTFAD</span>
            <span className={styles.statValue}>{ttfadMs != null ? fmtDuration(ttfadMs) : '—'}</span>
          </div>
        </section>
        <p className={styles.muted}>
          Funnel: {FUNNEL.map((f) => `${fired.has(f.name) ? '✓' : '·'} ${f.label}`).join('   ')}
        </p>
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
