import 'server-only';

/**
 * Deterministic specialist programs — one per shop template (§4.6). v0 is
 * model-free by design: drafts are composed from structured provider data
 * with templated language, so LLM COGS stays $0 and no real `generate` ships
 * before the durable frontier-budget store (issue #24). When a model joins,
 * it slots in as a 'specialist_draft' (T1) route behind the same runner —
 * the enforcement around it does not change.
 *
 * Programs are generators the runner drives: they yield read steps, receive
 * quarantined results, and end with one proposed action (a draft). They never
 * touch a connector directly and never see an unquarantined byte.
 */
import type { QuarantinedContent } from '@nibbin/connectors';
import {
  interpretSpec,
  nudgeOverdueEmail,
  nudgeOverdueInvoice,
  nudgeUnconfirmedEvent,
  replyNewInquiry,
  type AgentSpec,
  type ProgramFn,
  type ProgramStep,
} from '@nibbin/runtime';
import { parseQuarantinedJson } from '@nibbin/scan';

/** Provider → connection id for the adopting account. */
export type ConnectionMap = Partial<Record<string, string>>;

function gmailListPath(scope: 'in:inbox' | 'in:sent', sinceMs: number): string {
  const d = new Date(sinceMs);
  const day = `${d.getUTCFullYear()}/${String(d.getUTCMonth() + 1).padStart(2, '0')}/${String(d.getUTCDate()).padStart(2, '0')}`;
  const params = new URLSearchParams({ q: `after:${day} ${scope}`, maxResults: '100' });
  return `/gmail/v1/users/me/messages?${params}`;
}

function gmailMetaPath(id: string): string {
  const meta = new URLSearchParams({ format: 'metadata' });
  for (const h of ['From', 'To', 'Subject', 'Date', 'List-Unsubscribe', 'In-Reply-To']) {
    meta.append('metadataHeaders', h);
  }
  return `/gmail/v1/users/me/messages/${encodeURIComponent(id)}?${meta}`;
}

interface GmailMeta {
  id: string;
  threadId: string;
  internalDate?: string;
  payload?: { headers?: Array<{ name: string; value: string }> };
}

function header(m: GmailMeta, name: string): string | undefined {
  return m.payload?.headers?.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value;
}

const DAY = 86_400_000;
// Sampled per scope; ×2 scopes + 2 list calls must stay under the run's
// maxSteps ceiling (120) with headroom (cost-auditor P1-1).
const MAIL_SAMPLE = 40;

interface MailScan {
  inbox: GmailMeta[];
  sent: GmailMeta[];
}

/** Shared mailbox sweep used by several programs. */
async function* readMailbox(
  connectionId: string,
  nowMs: number,
): AsyncGenerator<ProgramStep, MailScan, QuarantinedContent | undefined> {
  const since = nowMs - 90 * DAY;
  const out: MailScan = { inbox: [], sent: [] };
  for (const scope of ['in:inbox', 'in:sent'] as const) {
    const listRes = yield { kind: 'read', capability: 'email.read', connectionId, path: gmailListPath(scope, since) };
    const list = listRes ? parseQuarantinedJson<{ messages?: Array<{ id: string }> }>(listRes) : null;
    for (const ref of (list?.messages ?? []).slice(0, MAIL_SAMPLE)) {
      const metaRes = yield { kind: 'read', capability: 'email.read', connectionId, path: gmailMetaPath(ref.id) };
      const meta = metaRes ? parseQuarantinedJson<GmailMeta>(metaRes) : null;
      if (meta) (scope === 'in:inbox' ? out.inbox : out.sent).push(meta);
    }
  }
  return out;
}

/* ── Programs ─────────────────────────────────────────────────────────────── */

/**
 * Route a run to its program. A composed spec (`steps[]` present, future
 * Composer output / the Slice-1 proof agent) runs through the declarative
 * interpreter; everything else routes to its hand-written template program,
 * byte-for-byte unchanged. The interpreter yields ProgramSteps the same runner
 * gates — no execution path lives outside the runner either way.
 */
export function buildProgram(spec: AgentSpec, connections: ConnectionMap, nowMs: number): ProgramFn {
  if (spec.steps && spec.steps.length > 0) return interpretSpec(spec, connections, nowMs);
  switch (spec.templateKey) {
    case 'echo':
      return echoProgram(connections, nowMs);
    case 'sweep':
      return sweepProgram(connections, nowMs);
    case 'scribe':
      return scribeProgram(connections, nowMs);
    case 'brief':
      return briefProgram(connections, nowMs);
    case 'tally':
      return tallyProgram(connections, nowMs);
    case 'hopper':
      return hopperProgram(connections, nowMs);
    default:
      throw new Error(`no program for spec (templateKey=${spec.templateKey})`);
  }
}

function requireConn(connections: ConnectionMap, provider: string): string {
  const id = connections[provider];
  if (!id) throw new Error(`no active ${provider} connection — pausing politely`);
  return id;
}

/**
 * Echo delegates to the SHARED `nudge.overdue-email` primitive implementation
 * (packages/runtime) — the template and the composable primitive are now the
 * SAME code, so a synthesized detect-and-nudge agent behaves byte-for-byte
 * like Echo (parity test in packages/runtime).
 *
 * The "no active gmail connection — pausing politely" guard lives INSIDE the
 * primitive's generator body (nudge-overdue-email.ts), NOT here at factory
 * build time: an eager throw would fire before executeRun creates the run row,
 * propagate out of triggerNibbinRun, and abort the dispatch fan-out loop (the
 * cursor would never advance → re-fires forever; no `failed` run recorded).
 * Delegating to the primitive keeps the throw inside the generator, where
 * executeRun's try/catch records a clean `failed` run.
 */
function echoProgram(connections: ConnectionMap, nowMs: number): ProgramFn {
  return nudgeOverdueEmail({ staleDays: 3 }, connections, nowMs);
}

function sweepProgram(connections: ConnectionMap, nowMs: number): ProgramFn {
  return async function* () {
    const gmail = requireConn(connections, 'gmail');
    const mail = yield* readMailbox(gmail, nowMs);
    const noise = mail.inbox.filter((m) => header(m, 'List-Unsubscribe'));
    const senders = new Map<string, number>();
    for (const m of noise) {
      const from = (header(m, 'From') ?? 'unknown').replace(/.*<|>.*/g, '');
      senders.set(from, (senders.get(from) ?? 0) + 1);
    }
    const top = [...senders.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
    yield {
      kind: 'draft',
      capability: 'email.read',
      connectionId: gmail,
      patternKey: 'sweep:keep-or-clear',
      presentation: true,
      title: 'This morning’s sweep',
      draft:
        top.length === 0
          ? 'Your inbox floor is clean — no newsletter pile worth clearing today.'
          : `${noise.length} newsletter-ish messages are sitting in your inbox. The biggest piles:\n` +
            top.map(([s, n]) => `• ${s} — ${n} messages`).join('\n') +
            '\nSay the word and I’ll keep flagging these for a one-tap clear.',
      effectArgs: { senders: top.map(([s]) => s) },
    };
  };
}

/**
 * Scribe delegates to the SHARED `reply.new-inquiry` primitive implementation
 * (packages/runtime) — the template and the composable primitive are the SAME
 * code, so a synthesized inquiry-reply agent behaves byte-for-byte like Scribe
 * (parity test in packages/runtime). The "no gmail connection" pause lives
 * INSIDE the primitive's generator (Slice-2a P1), not here at build time.
 */
function scribeProgram(connections: ConnectionMap, nowMs: number): ProgramFn {
  return replyNewInquiry({}, connections, nowMs);
}

function briefProgram(connections: ConnectionMap, nowMs: number): ProgramFn {
  return async function* () {
    const gmail = requireConn(connections, 'gmail');
    const gcal = requireConn(connections, 'google-calendar');
    const stripe = requireConn(connections, 'stripe');

    const evParams = new URLSearchParams({
      timeMin: new Date(nowMs - DAY).toISOString(),
      timeMax: new Date(nowMs + 2 * DAY).toISOString(),
      singleEvents: 'true',
      maxResults: '250',
      orderBy: 'startTime',
    });
    const evRes = yield {
      kind: 'read',
      capability: 'calendar.read',
      connectionId: gcal,
      path: `/calendar/v3/calendars/primary/events?${evParams}`,
    };
    const events =
      (evRes && parseQuarantinedJson<{ items?: Array<{ summary?: string; start?: { dateTime?: string } }> }>(evRes))
        ?.items ?? [];

    const invParams = new URLSearchParams({
      'created[gte]': String(Math.floor((nowMs - 90 * DAY) / 1000)),
      limit: '100',
    });
    const invRes = yield {
      kind: 'read',
      capability: 'payments.read',
      connectionId: stripe,
      path: `/v1/invoices?${invParams}`,
    };
    const invoices =
      (invRes &&
        parseQuarantinedJson<{ data?: Array<{ status?: string; due_date?: number | null; amount_due?: number }> }>(invRes))
        ?.data ?? [];
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
    };
  };
}

/**
 * Tally delegates to the SHARED `nudge.overdue-invoice` primitive
 * implementation — byte-for-byte identical to the primitive at its default
 * `minDaysLate=0` (parity test in packages/runtime). The "no stripe connection"
 * pause lives INSIDE the primitive's generator (Slice-2a P1).
 */
function tallyProgram(connections: ConnectionMap, nowMs: number): ProgramFn {
  return nudgeOverdueInvoice({ minDaysLate: 0 }, connections, nowMs);
}

/**
 * Hopper delegates to the SHARED CROSS-RESOURCE `nudge.unconfirmed-event`
 * primitive implementation — byte-for-byte identical at its default
 * `withinDays=7` (parity test in packages/runtime). It reads the calendar and
 * drafts the confirmation email; the "no calendar/gmail connection" pause lives
 * INSIDE the primitive's generator and checks BOTH connectors (Slice-2a P1).
 */
function hopperProgram(connections: ConnectionMap, nowMs: number): ProgramFn {
  return nudgeUnconfirmedEvent({ withinDays: 7 }, connections, nowMs);
}
