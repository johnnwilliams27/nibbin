/**
 * `nudge.overdue-email` — the detect-and-nudge PRIMITIVE (design §1/§2.1).
 *
 * This is the SAME read→detect→draft logic the `echo` template runs, lifted
 * into runtime as a parameterized `ProgramFn` factory so the Composer can
 * compose it by id + typed params. The template program (apps/web
 * programs.ts) delegates to these exact internals, so the primitive and the
 * template stay byte-for-byte identical (parity test).
 *
 * SAFETY (load-bearing): the Composer never emits `inputs.path` or
 * `effectArgs` — it picks this primitive's id + schema-validated scalar params
 * (`staleDays`). The read paths, the overdue detection, the recipient/subject
 * args, and the prompt are all built by THIS trusted code. The interpreter
 * still only *yields* the steps; the runner gates every one.
 *
 * It yields exactly what echoProgram yields: the mailbox sweep reads, then
 * either a no-op compose ("nothing to draft") or a compose→draft handoff with
 * the model prompt + sanitized effectArgs.
 */
import type { QuarantinedContent } from '@nibbin/connectors';
import { QUARANTINE_PREFIX } from '@nibbin/connectors';
import type { ProgramFn } from '../runner';
import type { ProgramStep } from '../types';

type ConnectionMap = Record<string, string | undefined>;

const DAY = 86_400_000;
// Sampled per scope; ×2 scopes + 2 list calls must stay under the run's
// maxSteps ceiling (120) with headroom (cost-auditor P1-1). Matches programs.ts.
const MAIL_SAMPLE = 40;
/** Longest body a model draft may contribute. Matches echoProgram. */
const MODEL_DRAFT_MAX_CHARS = 1200;

/* ── quarantine parsing (runtime cannot import @nibbin/scan — scan depends on
 *    runtime; the reverse edge would be a cycle). Exact-string unwrap, mirror
 *    of @nibbin/scan's unwrapQuarantined. ─────────────────────────────────── */

function unwrap(content: QuarantinedContent): string {
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

function parseQuarantinedJson<T>(content: QuarantinedContent): T | null {
  try {
    return JSON.parse(unwrap(content)) as T;
  } catch {
    return null;
  }
}

function modelDraftOr(fallback: string, fed: QuarantinedContent | undefined): string {
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

export interface GmailMeta {
  id: string;
  threadId: string;
  internalDate?: string;
  payload?: { headers?: Array<{ name: string; value: string }> };
}

function header(m: GmailMeta, name: string): string | undefined {
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

export interface NudgeOverdueEmailInputs {
  /** Threads older than this many days are overdue. Default 3 (echo's floor). */
  staleDays?: number;
  /** Routine-matching identity for the draft. Default echo's key for parity. */
  patternKey?: string;
}

/**
 * The parameterized echo program: the trusted implementation of the
 * `nudge.overdue-email` primitive. `echoProgram` (apps/web) delegates here.
 */
export function nudgeOverdueEmail(
  inputs: NudgeOverdueEmailInputs,
  connMap: ConnectionMap,
  nowMs: number,
): ProgramFn {
  const staleDays = inputs.staleDays ?? 3;
  const patternKey = inputs.patternKey ?? 'email.draft:overdue-followup';
  return async function* () {
    const gmail = connMap.gmail;
    if (!gmail) throw new Error('no active gmail connection — pausing politely');
    const mail = yield* readMailbox(gmail, nowMs);
    const overdue = overdueInbound(mail, nowMs, staleDays);
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
      patternKey,
      title: `Follow-up on “${subject}” (waiting ${waitedDays} days)`,
      draft: modelDraftOr(fallback, fed),
      effectArgs: { threadId: oldest.threadId, to: safeAddress(from), subject: `Re: ${subject}` },
    } satisfies ProgramStep;
  };
}
