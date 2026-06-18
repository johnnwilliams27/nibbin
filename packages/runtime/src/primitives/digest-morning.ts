/**
 * `digest.morning` — the 3-CONNECTOR SUMMARIZE/DIGEST PRIMITIVE (design §2.2),
 * lifted from the `brief` template. The template program (apps/web programs.ts)
 * delegates to THIS exact implementation, so the primitive and `brief` stay
 * byte-for-byte identical (parity test).
 *
 * Shape: `calendar.read` (google-calendar — upcoming events, now−1d…now+2d) +
 * `payments.read` (stripe — overdue invoices over a 90-day window) +
 * `email.read` (gmail — fresh inbox count over the last 2 days) → compose ONE
 * 3-part morning digest. This is the cross-resource THREE-WAY read case: each
 * read rides its own connection; the digest rides the gmail connection. The
 * Composer derives ALL THREE required connectors from this primitive's
 * `effectiveTools` (server-side, never from the LLM).
 *
 * PRESENTATION ONLY: the yielded draft is a READ capability (`email.read`) with
 * `presentation: true`, so the runner gates it as a draft ALWAYS and never
 * executes a side effect (no email is ever sent — the digest is presented).
 *
 * SAFETY (load-bearing): the Composer never emits the read paths or effectArgs —
 * it picks this primitive's id only (empty input schema). The read paths, the
 * overdue filter + dollar sum, the fresh-mail count, and the digest body are
 * built by THIS trusted code. The polite pause throws INSIDE the generator and
 * checks ALL THREE connectors up front (the Slice-2a P1 lesson), before any read.
 */
import type { ProgramFn } from '../runner';
import type { ProgramStep } from '../types';
import { DAY, calendarEventsPath, gmailListPath, parseQuarantinedJson, stripeInvoicesPath } from './shared';

type ConnectionMap = Record<string, string | undefined>;

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface DigestMorningInputs {}

interface CalEvent {
  summary?: string;
  start?: { dateTime?: string };
}
interface Invoice {
  status?: string;
  due_date?: number | null;
  amount_due?: number;
}

/**
 * The parameterized brief program: the trusted implementation of the
 * `digest.morning` primitive. `briefProgram` (apps/web) delegates here. Reads
 * gcal on the gcal connection, stripe on the stripe connection, gmail on the
 * gmail connection; presents the 3-part digest. No knobs (brief has fixed
 * windows; an empty input schema is valid — Slice 2a/2b precedent).
 */
export function digestMorning(
  _inputs: DigestMorningInputs,
  connMap: ConnectionMap,
  nowMs: number,
): ProgramFn {
  return async function* () {
    // Polite pause checks ALL THREE connectors up front, INSIDE the generator
    // (Slice-2a P1), before any read. brief's requireConn order is gmail, gcal,
    // stripe — mirror it byte-for-byte so a missing-connection failure throws
    // the identical message the template would.
    const gmail = connMap.gmail;
    if (!gmail) throw new Error('no active gmail connection — pausing politely');
    const gcal = connMap['google-calendar'];
    if (!gcal) throw new Error('no active google-calendar connection — pausing politely');
    const stripe = connMap.stripe;
    if (!stripe) throw new Error('no active stripe connection — pausing politely');

    const evRes = yield {
      kind: 'read',
      capability: 'calendar.read',
      connectionId: gcal,
      path: calendarEventsPath(nowMs - DAY, nowMs + 2 * DAY),
    };
    const events = (evRes && parseQuarantinedJson<{ items?: CalEvent[] }>(evRes))?.items ?? [];

    const invRes = yield {
      kind: 'read',
      capability: 'payments.read',
      connectionId: stripe,
      path: stripeInvoicesPath(nowMs - 90 * DAY),
    };
    const invoices = (invRes && parseQuarantinedJson<{ data?: Invoice[] }>(invRes))?.data ?? [];
    const overdue = invoices.filter(
      (i) => i.status === 'open' && typeof i.due_date === 'number' && i.due_date * 1000 < nowMs,
    );
    const overdueDollars = Math.round(overdue.reduce((s, i) => s + (i.amount_due ?? 0), 0) / 100);

    const mailList = yield {
      kind: 'read',
      capability: 'email.read',
      connectionId: gmail,
      path: gmailListPath('in:inbox', nowMs - 2 * DAY),
    };
    const freshMail = (mailList && parseQuarantinedJson<{ messages?: unknown[] }>(mailList))?.messages?.length ?? 0;

    const upcoming = events
      .slice(0, 3)
      .map((e) => `• ${e.summary ?? 'Booked session'}${e.start?.dateTime ? ` — ${new Date(e.start.dateTime).toLocaleString('en-US', { weekday: 'short', hour: 'numeric', minute: '2-digit' })}` : ''}`)
      .join('\n');
    yield {
      kind: 'draft',
      capability: 'email.read',
      connectionId: gmail,
      patternKey: 'brief:morning-digest',
      presentation: true,
      title: 'Your morning, the short version',
      draft: [
        events.length > 0 ? `Next on the calendar:\n${upcoming}` : 'Calendar is clear through tomorrow.',
        freshMail > 0 ? `${freshMail} new messages landed in the last two days.` : 'Inbox has been quiet.',
        overdue.length > 0
          ? `${overdue.length} invoices are past due — $${overdueDollars.toLocaleString('en-US')} you already earned.`
          : 'No invoices are past due. Money side is tidy.',
      ].join('\n\n'),
      effectArgs: { events: events.length, freshMail, overdue: overdue.length },
    } satisfies ProgramStep;
  };
}
