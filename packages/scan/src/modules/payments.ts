/**
 * Payments scan modules (§4.4): invoice latency (created → finalized),
 * overdue balances, fee leakage, recurring-client revenue share.
 * Adapter: stripe (Connect, read_only scope — C8 holds at the provider).
 */
import type { ScanContext, ScanModule } from '@nibbin/connectors';
import { SCAN_WINDOW_MONTHS } from '@nibbin/connectors';
import { DAY_MS, makeFinding, median, round1 } from '../findings';
import { parseQuarantinedJson } from '../unwrap';

interface StripeInvoice {
  id: string;
  status?: string;
  created: number; // epoch seconds
  due_date?: number | null;
  amount_due?: number; // cents
  amount_paid?: number;
  customer?: string;
  subscription?: string | null;
  status_transitions?: { finalized_at?: number | null; paid_at?: number | null };
}

interface StripeList<T> {
  data: T[];
  has_more: boolean;
}

async function fetchInvoices(ctx: ScanContext): Promise<StripeInvoice[]> {
  const params = new URLSearchParams({
    'created[gte]': String(Math.floor(ctx.window.startMs / 1000)),
    limit: '100',
  });
  const res = parseQuarantinedJson<StripeList<StripeInvoice>>(
    await ctx.reader.read(`/v1/invoices?${params}`),
  );
  return res?.data ?? [];
}

export const paymentsInvoiceLatency: ScanModule = {
  id: 'payments.invoice-latency',
  providers: ['stripe'],
  async run(ctx) {
    const invoices = await fetchInvoices(ctx);
    const gaps = invoices
      .map((i) => {
        const fin = i.status_transitions?.finalized_at;
        return fin ? (fin - i.created) * 1000 : null;
      })
      .filter((g): g is number => g !== null && g >= 0);
    if (gaps.length < 5) return [];
    const medianDays = round1(median(gaps) / DAY_MS);
    if (medianDays < 3) return [];
    return [
      makeFinding(
        this.id,
        ctx.connection.id,
        `Invoices sit ${medianDays} days as drafts before they go out — every one of those days delays the payment clock.`,
        {
          hoursPerWeek: round1((gaps.length * 6) / 60 / 13),
          basis: `${gaps.length} invoices in 12 months; median created→finalized gap ${medianDays} days; ~6 min of chasing each`,
        },
        { invoices: gaps.length, medianDays },
      ),
    ];
  },
};

export const paymentsOverdueBalances: ScanModule = {
  id: 'payments.overdue-balances',
  providers: ['stripe'],
  async run(ctx) {
    const invoices = await fetchInvoices(ctx);
    const nowSecs = Math.floor(ctx.window.endMs / 1000);
    const overdue = invoices.filter(
      (i) => i.status === 'open' && typeof i.due_date === 'number' && i.due_date < nowSecs,
    );
    if (overdue.length === 0) return [];
    const totalDollars = Math.round(overdue.reduce((s, i) => s + (i.amount_due ?? 0), 0) / 100);
    const oldestDays = Math.round(
      (nowSecs - Math.min(...overdue.map((i) => i.due_date ?? nowSecs))) / 86_400,
    );
    return [
      makeFinding(
        this.id,
        ctx.connection.id,
        `$${totalDollars.toLocaleString('en-US')} across ${overdue.length} invoices is past due — the oldest by ${oldestDays} days. Money you already earned.`,
        {
          dollarsPerMonth: totalDollars,
          basis: `${overdue.length} open invoices past due_date right now; amounts summed from amount_due`,
        },
        { overdue: overdue.length, totalDollars, oldestDays, invoiceIds: overdue.slice(0, 10).map((i) => i.id) },
      ),
    ];
  },
};

export const paymentsFeeLeakage: ScanModule = {
  id: 'payments.fee-leakage',
  providers: ['stripe'],
  async run(ctx) {
    const params = new URLSearchParams({
      'created[gte]': String(Math.floor(ctx.window.startMs / 1000)),
      limit: '100',
    });
    const res = parseQuarantinedJson<StripeList<{ id: string; fee: number; amount: number }>>(
      await ctx.reader.read(`/v1/balance_transactions?${params}`),
    );
    const txns = res?.data ?? [];
    if (txns.length < 5) return [];
    const feeDollarsMonth = Math.round(txns.reduce((s, t) => s + (t.fee ?? 0), 0) / 100 / SCAN_WINDOW_MONTHS);
    if (feeDollarsMonth < 20) return [];
    return [
      makeFinding(
        this.id,
        ctx.connection.id,
        `Processing fees are nibbling about $${feeDollarsMonth} a month off your payments.`,
        {
          dollarsPerMonth: feeDollarsMonth,
          basis: `fees summed over ${txns.length} balance transactions in 12 months, divided by ${SCAN_WINDOW_MONTHS} months`,
        },
        { transactions: txns.length, feeDollarsMonth },
      ),
    ];
  },
};

export const paymentsRecurringRevenue: ScanModule = {
  id: 'payments.recurring-revenue',
  providers: ['stripe'],
  async run(ctx) {
    const invoices = await fetchInvoices(ctx);
    const paid = invoices.filter((i) => (i.amount_paid ?? 0) > 0);
    if (paid.length < 5) return [];
    const recurring = paid.filter((i) => i.subscription);
    const total = paid.reduce((s, i) => s + (i.amount_paid ?? 0), 0);
    const recurringShare = total > 0 ? recurring.reduce((s, i) => s + (i.amount_paid ?? 0), 0) / total : 0;
    const sharePct = Math.round(recurringShare * 100);
    if (sharePct < 10) return [];
    return [
      makeFinding(
        this.id,
        ctx.connection.id,
        `${sharePct}% of your revenue comes from repeat clients — worth knowing who they are before they go quiet.`,
        {
          dollarsPerMonth: Math.round((recurring.reduce((s, i) => s + (i.amount_paid ?? 0), 0) / 100) / SCAN_WINDOW_MONTHS),
          basis: `${recurring.length} of ${paid.length} paid invoices ride a subscription; amounts from amount_paid over ${SCAN_WINDOW_MONTHS} months`,
        },
        { paidInvoices: paid.length, recurringInvoices: recurring.length, sharePct },
      ),
    ];
  },
};

export const PAYMENTS_MODULES = [
  paymentsInvoiceLatency,
  paymentsOverdueBalances,
  paymentsFeeLeakage,
  paymentsRecurringRevenue,
];
