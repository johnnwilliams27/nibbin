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
import { interpretSpec, type AgentSpec, type ProgramFn, type ProgramStep } from '@nibbin/runtime';
import { parseQuarantinedJson, unwrapQuarantined } from '@nibbin/scan';

/** Provider → connection id for the adopting account. */
export type ConnectionMap = Partial<Record<string, string>>;

/** Longest body a model draft may contribute; beyond this we trust the template. */
const MODEL_DRAFT_MAX_CHARS = 1200;

/**
 * Use a runner-provided model draft when one came back, the deterministic
 * template when it didn't (no model wired, outage, ceiling, or junk output).
 * The unwrap can only throw on content the runner didn't produce — treat any
 * irregularity as "no draft" and fall back; a run never fails over prose.
 */
function modelDraftOr(fallback: string, fed: QuarantinedContent | undefined): string {
  if (!fed) return fallback;
  try {
    const text = unwrapQuarantined(fed).trim();
    if (text.length === 0 || text.length > MODEL_DRAFT_MAX_CHARS) return fallback;
    return text;
  } catch {
    return fallback;
  }
}

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

/**
 * Connector-derived strings (From/Subject/attendee email) are external,
 * attacker-influenceable data. They are safe to RENDER (React escapes), but
 * before they become the recipient/subject ARGUMENTS of a real side effect
 * they must be neutralized: strip CR/LF (header-injection) and cap length.
 * Quarantine keeps connector content as data; this keeps it from becoming the
 * parameters of an action (red-team P2-2). Applied at the effectArgs boundary.
 */
function safeHeaderValue(raw: string | undefined, max = 256): string {
  return (raw ?? '').replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}

/** A plausible single email address, or '' — never a header-injection vector. */
function safeAddress(raw: string | undefined): string {
  const v = safeHeaderValue(raw, 320);
  const m = v.match(/<([^<>@\s]+@[^<>@\s]+)>/) ?? v.match(/([^<>@\s]+@[^<>@\s]+)/);
  const addr = m?.[1] ?? '';
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(addr) ? addr : '';
}

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

function overdueInbound(mail: MailScan, nowMs: number): GmailMeta[] {
  const answered = new Set(mail.sent.map((m) => m.threadId));
  return mail.inbox
    .filter(
      (m) =>
        !header(m, 'In-Reply-To') &&
        !header(m, 'List-Unsubscribe') &&
        !answered.has(m.threadId) &&
        nowMs - Number(m.internalDate ?? nowMs) > 3 * DAY,
    )
    .sort((a, b) => Number(a.internalDate ?? 0) - Number(b.internalDate ?? 0));
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
  if (spec.steps && spec.steps.length > 0) return interpretSpec(spec, connections);
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

function echoProgram(connections: ConnectionMap, nowMs: number): ProgramFn {
  return async function* () {
    const gmail = requireConn(connections, 'gmail');
    const mail = yield* readMailbox(gmail, nowMs);
    const overdue = overdueInbound(mail, nowMs);
    if (overdue.length === 0) {
      yield { kind: 'compose', payload: { note: 'no overdue threads — nothing to draft' } };
      return;
    }
    const oldest = overdue[0];
    const from = safeHeaderValue(header(oldest, 'From')) || 'them';
    const subject = safeHeaderValue(header(oldest, 'Subject')) || 'your last message';
    const waitedDays = Math.round((nowMs - Number(oldest.internalDate ?? nowMs)) / DAY);
    const fallback =
      `Hi — thanks for your patience, and sorry for the slow reply. ` +
      `I wanted to pick this back up: happy to answer anything still open on “${subject}”. ` +
      `If the timing moved on, no trouble at all — just let me know either way.`;
    // M6.5: ask the runner for a model draft (T1). Context is the same
    // sanitized metadata the template uses — never raw message bodies.
    const fed = yield {
      kind: 'compose',
      payload: { note: 'drafting overdue follow-up' },
      prompt: {
        intent:
          'Draft a short, warm follow-up email body for a conversation the sender let go quiet. ' +
          'Apologize briefly for the slow reply without groveling, reopen the thread, and make ' +
          'responding easy. Under 90 words. Output only the email body text.',
        context: `Subject: ${subject}\nWaiting: ${waitedDays} days\nRecipient (from header): ${from}`,
        maxTokens: 300,
      },
    };
    yield {
      kind: 'draft',
      capability: 'email.draft',
      connectionId: gmail,
      patternKey: 'email.draft:overdue-followup',
      title: `Follow-up on “${subject}” (waiting ${waitedDays} days)`,
      draft: modelDraftOr(fallback, fed),
      effectArgs: { threadId: oldest.threadId, to: safeAddress(from), subject: `Re: ${subject}` },
    };
  };
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

function scribeProgram(connections: ConnectionMap, nowMs: number): ProgramFn {
  return async function* () {
    const gmail = requireConn(connections, 'gmail');
    const mail = yield* readMailbox(gmail, nowMs);
    const answered = new Set(mail.sent.map((m) => m.threadId));
    const inquiries = mail.inbox
      .filter((m) => !header(m, 'In-Reply-To') && !header(m, 'List-Unsubscribe') && !answered.has(m.threadId))
      .sort((a, b) => Number(b.internalDate ?? 0) - Number(a.internalDate ?? 0));
    if (inquiries.length === 0) {
      yield { kind: 'compose', payload: { note: 'no unanswered inquiries' } };
      return;
    }
    const newest = inquiries[0];
    const subject = safeHeaderValue(header(newest, 'Subject')) || 'your note';
    const fallback =
      `Hi, and thanks so much for reaching out — I’d love to help. ` +
      `Could you share the date you have in mind and a little about what you’re planning? ` +
      `I’ll send over availability and a clear picture of how I work and what it costs. ` +
      `Looking forward to it.`;
    const fed = yield {
      kind: 'compose',
      payload: { note: 'drafting inquiry reply' },
      prompt: {
        intent:
          'Draft a short, warm first reply to a new business inquiry. Thank them for reaching ' +
          'out, ask for the date and a little about what they are planning, and say a clear ' +
          'picture of availability and pricing will follow. Under 90 words. Output only the ' +
          'email body text.',
        context: `Subject: ${subject}`,
        maxTokens: 300,
      },
    };
    yield {
      kind: 'draft',
      capability: 'email.draft',
      connectionId: gmail,
      patternKey: 'email.draft:inquiry-reply',
      title: `Reply to “${subject}”`,
      draft: modelDraftOr(fallback, fed),
      effectArgs: { threadId: newest.threadId, subject: `Re: ${subject}` },
    };
  };
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

function tallyProgram(connections: ConnectionMap, nowMs: number): ProgramFn {
  return async function* () {
    const stripe = requireConn(connections, 'stripe');
    const params = new URLSearchParams({
      'created[gte]': String(Math.floor((nowMs - 90 * DAY) / 1000)),
      limit: '100',
    });
    const res = yield {
      kind: 'read',
      capability: 'payments.read',
      connectionId: stripe,
      path: `/v1/invoices?${params}`,
    };
    const invoices =
      (res &&
        parseQuarantinedJson<{
          data?: Array<{ id: string; status?: string; due_date?: number | null; amount_due?: number; customer?: string }>;
        }>(res))
        ?.data ?? [];
    const overdue = invoices
      .filter((i) => i.status === 'open' && typeof i.due_date === 'number' && i.due_date * 1000 < nowMs)
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
    };
  };
}

function hopperProgram(connections: ConnectionMap, nowMs: number): ProgramFn {
  return async function* () {
    const gcal = requireConn(connections, 'google-calendar');
    const gmail = requireConn(connections, 'gmail');
    const params = new URLSearchParams({
      timeMin: new Date(nowMs).toISOString(),
      timeMax: new Date(nowMs + 7 * DAY).toISOString(),
      singleEvents: 'true',
      maxResults: '250',
      orderBy: 'startTime',
    });
    const res = yield {
      kind: 'read',
      capability: 'calendar.read',
      connectionId: gcal,
      path: `/calendar/v3/calendars/primary/events?${params}`,
    };
    const events =
      (res &&
        parseQuarantinedJson<{
          items?: Array<{
            id: string;
            summary?: string;
            status?: string;
            start?: { dateTime?: string };
            attendees?: Array<{ email?: string; self?: boolean; responseStatus?: string }>;
          }>;
        }>(res))
        ?.items ?? [];
    const unconfirmed = events.filter(
      (e) =>
        e.status !== 'cancelled' &&
        (e.attendees ?? []).some((a) => !a.self && a.responseStatus !== 'accepted' && a.responseStatus !== 'declined'),
    );
    if (unconfirmed.length === 0) {
      yield { kind: 'compose', payload: { note: 'everything coming up is confirmed' } };
      return;
    }
    const next = unconfirmed[0];
    const when = next.start?.dateTime
      ? new Date(next.start.dateTime).toLocaleString('en-US', { weekday: 'long', hour: 'numeric', minute: '2-digit' })
      : 'our scheduled time';
    const guestEmail = safeAddress((next.attendees ?? []).find((a) => !a.self)?.email);
    yield {
      kind: 'draft',
      capability: 'email.draft',
      connectionId: gmail,
      patternKey: 'email.draft:session-confirmation',
      title: `Confirmation for ${next.summary ?? 'your next session'}`,
      draft:
        `Hi! Looking forward to ${next.summary ?? 'our session'} on ${when}. ` +
        `Just confirming the time still works on your end — if anything changed, ` +
        `reply here and we’ll find a better slot. See you soon!`,
      effectArgs: { eventId: next.id, to: guestEmail },
    };
  };
}
