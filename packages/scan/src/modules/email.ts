/**
 * Email scan modules (§4.4): inquiry rate + response-time distribution,
 * unanswered/overdue threads, newsletter noise ratio.
 *
 * Metadata-computable by design (headers/labels only — the gmail.metadata
 * scope): nothing here reads a message body. The repeated-replies/FAQ module
 * needs gmail.readonly and stays dark until Google verification lands
 * (registry note).
 *
 * Adapters: gmail today. outlook-m365 / imap-smtp declare these module ids in
 * the registry and join when their read paths land (aggregator/M3 rails) —
 * the engine simply finds no module for them until then and the scan_empty
 * fallback keeps the experience whole.
 */
import type { ScanContext, ScanModule } from '@nibbin/connectors';
import { DAY_MS, makeFinding, median, round1, weeksIn } from '../findings';
import { parseQuarantinedJson } from '../unwrap';

interface GmailList {
  messages?: Array<{ id: string; threadId: string }>;
  resultSizeEstimate?: number;
}

interface GmailMeta {
  id: string;
  threadId: string;
  internalDate?: string;
  payload?: { headers?: Array<{ name: string; value: string }> };
}

interface EmailMeta {
  id: string;
  threadId: string;
  ts: number;
  isReply: boolean;
  hasUnsubscribe: boolean;
}

const SAMPLE = 60;

function header(m: GmailMeta, name: string): string | undefined {
  return m.payload?.headers?.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value;
}

function gmailQueryDate(ms: number): string {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}/${String(d.getUTCMonth() + 1).padStart(2, '0')}/${String(d.getUTCDate()).padStart(2, '0')}`;
}

async function fetchMailbox(ctx: ScanContext, scope: 'in:inbox' | 'in:sent'): Promise<EmailMeta[]> {
  const q = `after:${gmailQueryDate(ctx.window.startMs)} ${scope}`;
  const params = new URLSearchParams({ q, maxResults: '100' });
  const list = parseQuarantinedJson<GmailList>(await ctx.reader.read(`/gmail/v1/users/me/messages?${params}`));
  const out: EmailMeta[] = [];
  for (const ref of (list?.messages ?? []).slice(0, SAMPLE)) {
    const meta = new URLSearchParams({ format: 'metadata' });
    for (const h of ['From', 'To', 'Subject', 'Date', 'List-Unsubscribe', 'In-Reply-To']) {
      meta.append('metadataHeaders', h);
    }
    const m = parseQuarantinedJson<GmailMeta>(
      await ctx.reader.read(`/gmail/v1/users/me/messages/${encodeURIComponent(ref.id)}?${meta}`),
    );
    if (!m) continue;
    const ts = Number(m.internalDate ?? NaN);
    if (!Number.isFinite(ts) || ts < ctx.window.startMs || ts >= ctx.window.endMs) continue;
    out.push({
      id: m.id,
      threadId: m.threadId,
      ts,
      isReply: header(m, 'In-Reply-To') !== undefined,
      hasUnsubscribe: header(m, 'List-Unsubscribe') !== undefined,
    });
  }
  return out;
}

export const emailInquiryRate: ScanModule = {
  id: 'email.inquiry-rate',
  providers: ['gmail'],
  async run(ctx) {
    const inbox = await fetchMailbox(ctx, 'in:inbox');
    const sent = await fetchMailbox(ctx, 'in:sent');

    const inquiries = inbox.filter((m) => !m.isReply && !m.hasUnsubscribe);
    const weeks = weeksIn(ctx.window);
    const perWeek = inquiries.length / weeks;
    if (perWeek < 3) return [];

    const repliesByThread = new Map<string, number>();
    for (const s of sent.filter((m) => m.isReply)) {
      const prev = repliesByThread.get(s.threadId);
      if (prev === undefined || s.ts < prev) repliesByThread.set(s.threadId, s.ts);
    }
    const deltas = inquiries
      .map((q) => {
        const reply = repliesByThread.get(q.threadId);
        return reply !== undefined && reply > q.ts ? reply - q.ts : null;
      })
      .filter((d): d is number => d !== null);
    const medianHours = round1(median(deltas) / 3_600_000);

    const minutesEach = 5;
    return [
      makeFinding(
        this.id,
        ctx.connection.id,
        deltas.length > 0
          ? `New inquiries land about ${round1(perWeek)} times a week, and a reply typically takes ${medianHours} hours to go out.`
          : `New inquiries land about ${round1(perWeek)} times a week.`,
        {
          hoursPerWeek: round1((perWeek * minutesEach) / 60),
          basis: `${inquiries.length} fresh inbound threads in ${Math.round(weeks)} weeks (sampled); ~${minutesEach} min each; median reply ${medianHours}h across ${deltas.length} matched threads`,
        },
        { inquiries: inquiries.length, matchedReplies: deltas.length, medianReplyHours: medianHours },
      ),
    ];
  },
};

export const emailOverdueThreads: ScanModule = {
  id: 'email.overdue-threads',
  providers: ['gmail'],
  async run(ctx) {
    const inbox = await fetchMailbox(ctx, 'in:inbox');
    const sent = await fetchMailbox(ctx, 'in:sent');
    const answered = new Set(sent.map((m) => m.threadId));

    const overdueMs = 3 * DAY_MS;
    const overdue = inbox.filter(
      (m) => !m.isReply && !m.hasUnsubscribe && !answered.has(m.threadId) && ctx.window.endMs - m.ts > overdueMs,
    );
    if (overdue.length < 3) return [];

    const oldestDays = Math.round((ctx.window.endMs - Math.min(...overdue.map((m) => m.ts))) / DAY_MS);
    const minutesEach = 8;
    return [
      makeFinding(
        this.id,
        ctx.connection.id,
        `${overdue.length} conversations are still waiting on a reply from you — the oldest has waited ${oldestDays} days.`,
        {
          hoursPerWeek: round1((overdue.length * minutesEach) / 60),
          basis: `${overdue.length} inbound threads with no sent reply after 3+ days (sampled); ~${minutesEach} min to answer each`,
        },
        { overdue: overdue.length, oldestDays, threadIds: overdue.slice(0, 10).map((m) => m.threadId) },
      ),
    ];
  },
};

export const emailNewsletterNoise: ScanModule = {
  id: 'email.newsletter-noise',
  providers: ['gmail'],
  async run(ctx) {
    const inbox = await fetchMailbox(ctx, 'in:inbox');
    if (inbox.length < 20) return [];
    const noise = inbox.filter((m) => m.hasUnsubscribe);
    const share = noise.length / inbox.length;
    if (share < 0.25) return [];

    const weeks = weeksIn(ctx.window);
    const noisePerWeek = noise.length / weeks;
    return [
      makeFinding(
        this.id,
        ctx.connection.id,
        `${Math.round(share * 100)}% of your inbox is newsletters and notifications — about ${Math.round(noisePerWeek)} a week to wade through.`,
        {
          hoursPerWeek: round1((noisePerWeek * 0.5) / 60),
          basis: `${noise.length} of ${inbox.length} sampled inbox messages carry List-Unsubscribe; ~30 sec each to triage`,
        },
        { sampled: inbox.length, noise: noise.length, sharePct: Math.round(share * 100) },
      ),
    ];
  },
};

export const EMAIL_MODULES = [emailInquiryRate, emailOverdueThreads, emailNewsletterNoise];
