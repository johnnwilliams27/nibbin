/**
 * `nudge.overdue-invoice` — a CROSS-RESOURCE detect-and-nudge PRIMITIVE
 * (design §2.1), lifted from the `tally` template the same way
 * `nudge.unconfirmed-event` was lifted from `hopper`. The template program
 * (apps/web programs.ts) delegates to THIS exact implementation, so the
 * primitive and `tally` stay byte-for-byte identical (parity test) when
 * `minDaysLate` is at its default (0 = tally's behavior).
 *
 * Shape (2026-06-22 personalized-email decision): `payments.read` (stripe) →
 * detect overdue OPEN invoices (oldest due first) → draft a warm, brand-voice
 * `email.send` (GMAIL) to the invoice's customer with the real payment link.
 * Stripe stays a READ-ONLY connector — the nudge does NOT use a Stripe-native
 * invoice resend; it rides the existing email.send rail. This is the
 * cross-resource case: the read rides the stripe connection, the draft rides
 * the gmail connection. The Composer derives BOTH required connectors from this
 * primitive's `effectiveTools` (server-side, never from the LLM).
 *
 * SAFETY (load-bearing): the Composer never emits the read path or effectArgs —
 * it picks this primitive's id + the schema-validated `minDaysLate` scalar. The
 * stripe path, the overdue detection, the sanitized recipient address, the
 * stripe-host-validated pay link, and the `{invoiceId, to}` args are built by
 * THIS trusted code; the interpreter only yields the steps the runner gates. The
 * "no active stripe/gmail connection" pause throws INSIDE the generator and
 * checks BOTH connectors up front (Slice-2a P1), never at factory-build time.
 *
 * KNOWN LIMITATION (cost-auditor P1 — must be resolved before `send` action
 * level is enabled for an adopted Tally Nibbin): there is no CROSS-RUN dedup.
 * The invoice resource-claim prevents two simultaneous runs from nudging the
 * same invoice, but it releases at run-end, and schedule triggers carry no
 * dedupeKey (so the effect idempotency key falls back to runId per run). A
 * still-overdue invoice would therefore be re-nudged every scheduled run. Bound
 * this with a per-(nibbin, invoice) cooldown before Tally ships at Send (Stripe
 * is not connectable yet and Tally defaults to Draft, so it is unreachable
 * today). Tracked in docs/gates/2026-06-22-connector-stripe-invoice-nudge.md.
 */
import type { ProgramFn } from '../runner';
import type { ProgramStep } from '../types';
import { DAY, parseQuarantinedJson, safeAddress, safeStripeUrl, stripeInvoicesPath } from './shared';

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
  customer_email?: string | null;
  hosted_invoice_url?: string | null;
}

/**
 * The parameterized tally program: the trusted implementation of the
 * `nudge.overdue-invoice` primitive. `tallyProgram` (apps/web) delegates here.
 * Reads on the stripe connection, drafts the email on the gmail one.
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
    const gmail = connMap.gmail;
    if (!gmail) throw new Error('no active gmail connection — pausing politely');
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
    const to = safeAddress(worst.customer_email ?? undefined);
    if (!to) {
      yield { kind: 'compose', payload: { note: 'overdue invoice has no customer email on file' } };
      return;
    }
    // The pay link is external Stripe data — validate it is a real https
    // stripe.com URL before embedding it in a customer-facing email, else a
    // crafted invoice could turn the nudge into a phishing vector (red-team P1).
    // No valid link → degrade to a compose note rather than send a bad/blank URL.
    const payLink = safeStripeUrl(worst.hosted_invoice_url);
    if (!payLink) {
      yield { kind: 'compose', payload: { note: 'overdue invoice has no valid Stripe payment link' } };
      return;
    }
    const dollars = Math.round((worst.amount_due ?? 0) / 100);
    const daysLate = Math.round((nowMs - (worst.due_date ?? 0) * 1000) / DAY);
    yield {
      kind: 'draft',
      capability: 'email.send',
      connectionId: gmail,
      patternKey: 'email.send:invoice-nudge',
      title: `Payment nudge — $${dollars.toLocaleString('en-US')}, ${daysLate} days past due`,
      draft:
        `Hi! Just a gentle nudge on the invoice for $${dollars.toLocaleString('en-US')} — ` +
        `it came due ${daysLate} days ago and may have slipped past. ` +
        `You can pay it here whenever it's convenient: ${payLink}. ` +
        `Happy to answer anything in the meantime. Thank you!`,
      effectArgs: { invoiceId: worst.id, to },
    } satisfies ProgramStep;
  };
}
