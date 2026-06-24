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

/**
 * How far back the overdue-invoice scan reads Stripe invoices. This is coupled
 * to the Task 5a count cap: the floor's "≤ FLOOR_MAX_NUDGES per invoice"
 * property is effectively a LIFETIME cap only while this read window stays
 * SMALLER than NUDGE_LOOKBACK_MS (an invoice that can no longer be read can no
 * longer be nudged, so its full nudge history is always inside the lookback).
 * A test (`nudge-floor.test.ts`) asserts NUDGE_LOOKBACK_MS > this — widening it
 * past the lookback would let a long-lived invoice be nudged more than the cap,
 * so that change must also widen the lookback. (logic-skeptic P2-1.)
 */
export const OVERDUE_INVOICE_READ_WINDOW_MS = 90 * DAY;

export interface NudgeOverdueInvoiceInputs {
  /** Only nudge invoices at least this many days past due. Default 0 (tally). */
  minDaysLate?: number;
  /**
   * Task 5a — the owner's re-nudge cadence (business rule or learned). Both
   * fields are optional and the runtime CLAMPS them to the hard safety floor
   * (interval ≥ 3 days, count ≤ 4): the owner can be stricter, never looser.
   *   - `everyDays`  : min days between nudges for one invoice (default 7).
   *   - `maxNudges`  : stop after this many nudges for one invoice (default 3).
   */
  cadenceEveryDays?: number;
  cadenceMaxNudges?: number;
}

interface StripeInvoice {
  id: string;
  status?: string;
  due_date?: number | null;
  amount_due?: number;
  customer?: string;
  customer_email?: string | null;
  hosted_invoice_url?: string | null;
  /**
   * Stripe-dunning signals (read-only). When Stripe's OWN automatic collection
   * is driving this invoice, Stripe sends the customer its stock reminder email
   * on `next_payment_attempt`. Nudging on top of that double-dunns the customer
   * (a Nibbin email + a Stripe email). We detect active Stripe dunning and defer.
   */
  collection_method?: string | null;     // 'charge_automatically' = Stripe auto-collects
  auto_advance?: boolean | null;          // Stripe is auto-advancing the invoice lifecycle
  next_payment_attempt?: number | null;   // epoch secs — Stripe's next scheduled retry
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
  // The owner cadence travels with the draft's effectArgs; the runtime floor
  // store reads it and CLAMPS it to the hard safety floor (never looser). Built
  // here in trusted code — the Composer/LLM never supplies it.
  const nudgeCadence: { intervalMs?: number; maxNudges?: number } = {};
  if (typeof inputs.cadenceEveryDays === 'number') nudgeCadence.intervalMs = inputs.cadenceEveryDays * DAY;
  if (typeof inputs.cadenceMaxNudges === 'number') nudgeCadence.maxNudges = inputs.cadenceMaxNudges;
  return async function* () {
    const stripe = connMap.stripe;
    if (!stripe) throw new Error('no active stripe connection — pausing politely');
    const gmail = connMap.gmail;
    if (!gmail) throw new Error('no active gmail connection — pausing politely');
    const res = yield {
      kind: 'read',
      capability: 'payments.read',
      connectionId: stripe,
      path: stripeInvoicesPath(nowMs - OVERDUE_INVOICE_READ_WINDOW_MS),
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
    // Task 5a — Stripe-reminder coordination (avoid double-dunning). If Stripe's
    // OWN automatic collection is active on this invoice (charge_automatically +
    // auto_advance with a scheduled next_payment_attempt), Stripe is already
    // emailing the customer. Defer to Stripe rather than stack a second dunning
    // email on top. Read-only signal off the already-fetched invoice — no extra
    // Stripe call, no write. The owner can still see the overdue invoice; we just
    // don't pile on a personal nudge while Stripe is auto-dunning.
    //
    // A null/past `next_payment_attempt` is INTENTIONALLY treated as "Stripe not
    // currently dunning" (smart-retries exhausted, or manual `send_invoice`
    // collection) → we DO nudge. Only an actively-scheduled FUTURE Stripe retry
    // suppresses our nudge (logic-skeptic P3-3).
    const stripeAutoDunning =
      worst.collection_method === 'charge_automatically' &&
      worst.auto_advance === true &&
      typeof worst.next_payment_attempt === 'number' &&
      worst.next_payment_attempt * 1000 > nowMs;
    if (stripeAutoDunning) {
      yield {
        kind: 'compose',
        payload: { note: 'deferring to Stripe automatic reminders — avoiding double-dunning' },
      };
      return;
    }
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
      effectArgs: {
        invoiceId: worst.id,
        to,
        // Task 5a: the resource kind + owner cadence the runtime floor enforces.
        nudgeResourceKind: 'invoice',
        ...(nudgeCadence.intervalMs !== undefined || nudgeCadence.maxNudges !== undefined
          ? { nudgeCadence }
          : {}),
      },
    } satisfies ProgramStep;
  };
}
