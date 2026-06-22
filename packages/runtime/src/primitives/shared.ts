/**
 * Shared helpers for the detect-and-nudge PRIMITIVE family (design §1/§2).
 *
 * These are the EXACT internals the shop template programs (apps/web
 * programs.ts) use — lifted here so every primitive and its template stay
 * byte-for-byte identical (the parity tests). They cover the three connectors
 * the family touches:
 *  - gmail: list/meta path builders, quarantine parse, header/address
 *    sanitization, the mailbox sweep, and overdue-inbound detection.
 *  - google-calendar: the events query path builder.
 *  - stripe: the invoices query path builder.
 *
 * SAFETY (load-bearing): connector-derived strings are external,
 * attacker-influenceable data. `safeHeaderValue`/`safeAddress` neutralize them
 * (strip CR/LF — header injection, cap length) BEFORE they become the
 * recipient/subject ARGUMENTS of a real side effect (red-team P2-2). Read paths
 * are built HERE, never by the LLM.
 */
import type { QuarantinedContent } from '@nibbin/connectors';
import { QUARANTINE_PREFIX } from '@nibbin/connectors';
import type { ProgramStep } from '../types';

export const DAY = 86_400_000;
// Sampled per scope; ×2 scopes + 2 list calls must stay under the run's
// maxSteps ceiling (120) with headroom (cost-auditor P1-1). Matches programs.ts.
export const MAIL_SAMPLE = 40;
/** Longest body a model draft may contribute. Matches the templates. */
export const MODEL_DRAFT_MAX_CHARS = 1200;

/* ── quarantine parsing (runtime cannot import @nibbin/scan — scan depends on
 *    runtime; the reverse edge would be a cycle). Exact-string unwrap, mirror
 *    of @nibbin/scan's unwrapQuarantined. ─────────────────────────────────── */

export function unwrap(content: QuarantinedContent): string {
  const openPrefix = `<<<${QUARANTINE_PREFIX}:${content.tag} source="`;
  const headerEnd = '">>>\n';
  const close = `\n<<<END-${QUARANTINE_PREFIX}:${content.tag}>>>`;
  const text = content.wrapped;
  const q = text.startsWith(openPrefix) ? text.indexOf('"', openPrefix.length) : -1;
  const headerLen = q === -1 ? -1 : text.startsWith(headerEnd, q) ? q + headerEnd.length : -1;
  if (headerLen === -1 || !text.trimEnd().endsWith(close.trim())) {
    throw new Error('content is not a quarantine wrap from this connection');
  }
  const body = text.slice(headerLen, text.lastIndexOf(close));
  return body.split('\n').slice(2).join('\n');
}

export function parseQuarantinedJson<T>(content: QuarantinedContent): T | null {
  try {
    return JSON.parse(unwrap(content)) as T;
  } catch {
    return null;
  }
}

export function modelDraftOr(fallback: string, fed: QuarantinedContent | undefined): string {
  if (!fed) return fallback;
  try {
    const t = unwrap(fed).trim();
    if (t.length === 0 || t.length > MODEL_DRAFT_MAX_CHARS) return fallback;
    return t;
  } catch {
    return fallback;
  }
}

/* ── gmail path + header helpers (identical to programs.ts) ────────────────── */

export function gmailListPath(scope: 'in:inbox' | 'in:sent', sinceMs: number): string {
  const d = new Date(sinceMs);
  const day = `${d.getUTCFullYear()}/${String(d.getUTCMonth() + 1).padStart(2, '0')}/${String(d.getUTCDate()).padStart(2, '0')}`;
  const params = new URLSearchParams({ q: `after:${day} ${scope}`, maxResults: '100' });
  return `/gmail/v1/users/me/messages?${params}`;
}

export function gmailMetaPath(id: string): string {
  const meta = new URLSearchParams({ format: 'metadata' });
  for (const h of ['From', 'To', 'Subject', 'Date', 'List-Unsubscribe', 'In-Reply-To']) {
    meta.append('metadataHeaders', h);
  }
  return `/gmail/v1/users/me/messages/${encodeURIComponent(id)}?${meta}`;
}

export interface GmailMeta {
  id: string;
  threadId: string;
  internalDate?: string;
  payload?: { headers?: Array<{ name: string; value: string }> };
}

export function header(m: GmailMeta, name: string): string | undefined {
  return m.payload?.headers?.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value;
}

/**
 * Connector-derived strings are external, attacker-influenceable data. Before
 * they become the recipient/subject ARGUMENTS of a real side effect they must
 * be neutralized: strip CR/LF (header-injection) and cap length (red-team
 * P2-2). Identical to programs.ts.
 */
export function safeHeaderValue(raw: string | undefined, max = 256): string {
  return (raw ?? '').replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}

/** A plausible single email address, or '' — never a header-injection vector. */
export function safeAddress(raw: string | undefined): string {
  const v = safeHeaderValue(raw, 320);
  const m = v.match(/<([^<>@\s]+@[^<>@\s]+)>/) ?? v.match(/([^<>@\s]+@[^<>@\s]+)/);
  const addr = m?.[1] ?? '';
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(addr) ? addr : '';
}

/**
 * A trusted Stripe-hosted https URL, or '' — never an attacker-controlled link.
 * Stripe's `hosted_invoice_url` is external/quarantined data; a crafted invoice
 * could carry a `javascript:`/`data:`/phishing URL we would otherwise embed in a
 * customer-facing "pay here" email from the owner's trusted Nibbin (red-team P1).
 * Require scheme=https and host within stripe.com before it reaches any body.
 */
export function safeStripeUrl(raw: string | undefined | null): string {
  const v = safeHeaderValue(raw ?? undefined, 2048);
  if (!v) return '';
  let u: URL;
  try {
    u = new URL(v);
  } catch {
    return '';
  }
  if (u.protocol !== 'https:') return '';
  const host = u.hostname.toLowerCase();
  return host === 'stripe.com' || host.endsWith('.stripe.com') ? u.toString() : '';
}

export interface MailScan {
  inbox: GmailMeta[];
  sent: GmailMeta[];
}

/** Shared mailbox sweep — yields the read steps the runner gates. */
export async function* readMailbox(
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

/** Overdue inbound threads: unanswered, not a reply, not bulk, older than
 *  `staleDays`, oldest first. Parameterized; default matches echoProgram (3). */
export function overdueInbound(mail: MailScan, nowMs: number, staleDays = 3): GmailMeta[] {
  const answered = new Set(mail.sent.map((m) => m.threadId));
  return mail.inbox
    .filter(
      (m) =>
        !header(m, 'In-Reply-To') &&
        !header(m, 'List-Unsubscribe') &&
        !answered.has(m.threadId) &&
        nowMs - Number(m.internalDate ?? nowMs) > staleDays * DAY,
    )
    .sort((a, b) => Number(a.internalDate ?? 0) - Number(b.internalDate ?? 0));
}

/* ── calendar + stripe path builders (identical to programs.ts) ────────────── */

/** The gcal events query: singleEvents, orderBy startTime, maxResults 250.
 *  Matches hopperProgram/briefProgram. */
export function calendarEventsPath(timeMinMs: number, timeMaxMs: number): string {
  const params = new URLSearchParams({
    timeMin: new Date(timeMinMs).toISOString(),
    timeMax: new Date(timeMaxMs).toISOString(),
    singleEvents: 'true',
    maxResults: '250',
    orderBy: 'startTime',
  });
  return `/calendar/v3/calendars/primary/events?${params}`;
}

/** The stripe invoices query: created[gte]=…, limit 100. Matches tallyProgram. */
export function stripeInvoicesPath(sinceMs: number): string {
  const params = new URLSearchParams({
    'created[gte]': String(Math.floor(sinceMs / 1000)),
    limit: '100',
  });
  return `/v1/invoices?${params}`;
}
