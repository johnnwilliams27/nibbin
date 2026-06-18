/**
 * `nudge.overdue-invoice` — a detect-and-nudge PRIMITIVE (design §2.1), lifted
 * from the `tally` template the same way `nudge.overdue-email` was lifted from
 * `echo`. The template program (apps/web programs.ts) delegates to THIS exact
 * implementation, so the primitive and `tally` stay byte-for-byte identical
 * (parity test) when `minDaysLate` is at its default (0 = tally's behavior).
 *
 * Shape: `payments.read` (stripe) → detect overdue OPEN invoices (oldest due
 * first) → draft an `invoice.nudge` for the worst one.
 *
 * SAFETY (load-bearing): the Composer never emits the read path or effectArgs —
 * it picks this primitive's id + the schema-validated `minDaysLate` scalar. The
 * stripe path, the overdue detection, and the `{invoiceId, amountCents}` args
 * are built by THIS trusted code; the interpreter only yields the steps the
 * runner gates. The "no active stripe connection" pause throws INSIDE the
 * generator (Slice-2a P1), never at factory-build time.
 */
import type { ProgramFn } from '../runner';
import type { ProgramStep } from '../types';
import { DAY, parseQuarantinedJson, stripeInvoicesPath } from './shared';

type ConnectionMap = Record<string, string | undefined>;

export interface NudgeOverdueInvoiceInputs {
  /** Only nudge invoices at least this many days past due. Default 0 (tally). */
  minDaysLate?: number;
}

interface StripeInvoice {
  id: string;
  status?: string;
  due_date?: number | null;
  amount_due?: number;
  customer?: string;
}

/**
 * The parameterized tally program: the trusted implementation of the
 * `nudge.overdue-invoice` primitive. `tallyProgram` (apps/web) delegates here.
 */
export function nudgeOverdueInvoice(
  inputs: NudgeOverdueInvoiceInputs,
  connMap: ConnectionMap,
  nowMs: number,
): ProgramFn {
  const minDaysLate = inputs.minDaysLate ?? 0;
  return async function* () {
    const stripe = connMap.stripe;
    if (!stripe) throw new Error('no active stripe connection — pausing politely');
    const res = yield {
      kind: 'read',
      capability: 'payments.read',
      connectionId: stripe,
      path: stripeInvoicesPath(nowMs - 90 * DAY),
    };
    const invoices = (res && parseQuarantinedJson<{ data?: StripeInvoice[] }>(res))?.data ?? [];
    const cutoff = nowMs - minDaysLate * DAY;
    const overdue = invoices
      .filter((i) => i.status === 'open' && typeof i.due_date === 'number' && i.due_date * 1000 < cutoff)
      .sort((a, b) => (a.due_date ?? 0) - (b.due_date ?? 0));
    if (overdue.length === 0) {
      yield { kind: 'compose', payload: { note: 'no overdue invoices' } };
      return;
    }
    const worst = overdue[0];
    const dollars = Math.round((worst.amount_due ?? 0) / 100);
    const daysLate = Math.round((nowMs - (worst.due_date ?? 0) * 1000) / DAY);
    yield {
      kind: 'draft',
      capability: 'invoice.nudge',
      connectionId: stripe,
      patternKey: 'invoice.nudge:overdue',
      title: `Payment nudge — $${dollars.toLocaleString('en-US')}, ${daysLate} days past due`,
      draft:
        `Hi! Just a gentle nudge on the invoice for $${dollars.toLocaleString('en-US')} — ` +
        `it came due ${daysLate} days ago and may have slipped past. ` +
        `The original link still works; happy to resend it or answer anything. Thank you!`,
      effectArgs: { invoiceId: worst.id, amountCents: worst.amount_due ?? 0 },
    } satisfies ProgramStep;
  };
}
