/**
 * DM scan modules (§4.4 — "where creative inquiries actually arrive"):
 * inquiry rate and overdue threads over Instagram Business DMs.
 *
 * Self-identification is deterministic: the sender id that appears in the
 * most conversations is the account owner (every thread includes them; no
 * external sender spans them all).
 */
import type { ScanContext, ScanModule } from '@nibbin/connectors';
import { DAY_MS, makeFinding, round1, weeksIn } from '../findings';
import { parseQuarantinedJson } from '../unwrap';

interface IgConversation {
  id: string;
  updated_time?: string;
}

interface IgMessage {
  id: string;
  created_time?: string;
  from?: { id: string };
}

const CONVERSATION_CAP = 20;

async function fetchThreads(ctx: ScanContext): Promise<Array<{ id: string; messages: IgMessage[] }>> {
  const list = parseQuarantinedJson<{ data?: IgConversation[] }>(
    await ctx.reader.read('/v23.0/me/conversations?fields=id,updated_time'),
  );
  const threads: Array<{ id: string; messages: IgMessage[] }> = [];
  for (const convo of (list?.data ?? []).slice(0, CONVERSATION_CAP)) {
    const msgs = parseQuarantinedJson<{ data?: IgMessage[] }>(
      await ctx.reader.read(`/v23.0/${encodeURIComponent(convo.id)}/messages?fields=id,created_time,from,message`),
    );
    threads.push({ id: convo.id, messages: msgs?.data ?? [] });
  }
  return threads;
}

function selfId(threads: Array<{ messages: IgMessage[] }>): string | null {
  const presence = new Map<string, number>();
  for (const t of threads) {
    const senders = new Set(t.messages.map((m) => m.from?.id).filter((x): x is string => !!x));
    for (const s of senders) presence.set(s, (presence.get(s) ?? 0) + 1);
  }
  let best: string | null = null;
  let bestCount = 0;
  for (const [id, count] of presence) {
    if (count > bestCount) {
      best = id;
      bestCount = count;
    }
  }
  return best;
}

function ts(m: IgMessage): number | null {
  if (!m.created_time) return null;
  const t = Date.parse(m.created_time);
  return Number.isFinite(t) ? t : null;
}

export const dmInquiryRate: ScanModule = {
  id: 'dm.inquiry-rate',
  providers: ['instagram-dm'],
  async run(ctx) {
    const threads = await fetchThreads(ctx);
    const me = selfId(threads);
    const fresh = threads.filter((t) => {
      const stamps = t.messages.map(ts).filter((x): x is number => x !== null);
      if (stamps.length === 0) return false;
      const first = Math.min(...stamps);
      const opener = t.messages.find((m) => ts(m) === first);
      return first >= ctx.window.startMs && first < ctx.window.endMs && opener?.from?.id !== me;
    });
    const weeks = weeksIn(ctx.window);
    const perWeek = fresh.length / weeks;
    if (perWeek < 1) return [];
    return [
      makeFinding(
        this.id,
        ctx.connection.id,
        `About ${round1(perWeek)} new conversations open in your DMs every week — and DM inquiries expect fast answers.`,
        {
          hoursPerWeek: round1((perWeek * 6) / 60),
          basis: `${fresh.length} conversations opened by someone else in ${Math.round(weeks)} weeks (${threads.length} threads sampled); ~6 min each`,
        },
        { freshThreads: fresh.length, sampled: threads.length },
      ),
    ];
  },
};

export const dmOverdueThreads: ScanModule = {
  id: 'dm.overdue-threads',
  providers: ['instagram-dm'],
  async run(ctx) {
    const threads = await fetchThreads(ctx);
    const me = selfId(threads);
    const overdue = threads.filter((t) => {
      const stamps = t.messages.map(ts).filter((x): x is number => x !== null);
      if (stamps.length === 0) return false;
      const last = Math.max(...stamps);
      const lastMsg = t.messages.find((m) => ts(m) === last);
      return lastMsg?.from?.id !== me && ctx.window.endMs - last > 2 * DAY_MS;
    });
    if (overdue.length < 2) return [];
    return [
      makeFinding(
        this.id,
        ctx.connection.id,
        `${overdue.length} DM conversations ended on their message, not yours, 2+ days ago — would-be clients still waiting.`,
        {
          hoursPerWeek: round1((overdue.length * 5) / 60),
          basis: `${overdue.length} of ${threads.length} sampled threads where the last message is inbound and 2+ days old`,
        },
        { overdue: overdue.length, sampled: threads.length },
      ),
    ];
  },
};

export const DM_MODULES = [dmInquiryRate, dmOverdueThreads];
