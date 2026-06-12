/**
 * Synthetic provider fixtures — the seeded-account path (M4 DoD: "scan →
 * adopt → first approved draft in <10 min on a seeded account") and the scan
 * module test corpus. Staging uses synthetic data only (AGREEMENTS).
 *
 * Everything is deterministic relative to `nowMs`. Names and addresses are
 * obviously fake; payloads go through the real quarantine wrapper so the
 * pipeline under test is the production pipeline.
 */
import { quarantine, type QuarantinedContent, type ScanResourceReader } from '@nibbin/connectors';

const DAY = 86_400_000;
const HOUR = 3_600_000;

type Json = Record<string, unknown>;

function ig(id: string, fromId: string, atMs: number): Json {
  return { id, created_time: new Date(atMs).toISOString(), from: { id: fromId }, message: '[fixture]' };
}

export function gmailFixtures(nowMs: number): { list: (scope: string) => Json; meta: (id: string) => Json | null } {
  interface Msg {
    id: string;
    threadId: string;
    ts: number;
    inReplyTo?: string;
    unsubscribe?: boolean;
    scope: 'inbox' | 'sent';
  }
  const msgs: Msg[] = [];
  // 30 inquiries, roughly one every 3 days
  for (let i = 0; i < 30; i++) {
    msgs.push({ id: `inq-${i}`, threadId: `t-${i}`, ts: nowMs - (4 + i * 2.8) * DAY, scope: 'inbox' });
  }
  // 16 newsletters
  for (let i = 0; i < 16; i++) {
    msgs.push({ id: `news-${i}`, threadId: `tn-${i}`, ts: nowMs - (2 + i * 5) * DAY, unsubscribe: true, scope: 'inbox' });
  }
  // replies sent for inquiries 6..29 (~26h later) — 0..5 stay overdue
  for (let i = 6; i < 30; i++) {
    msgs.push({
      id: `rep-${i}`, threadId: `t-${i}`, ts: nowMs - (4 + i * 2.8) * DAY + 26 * HOUR,
      inReplyTo: `inq-${i}`, scope: 'sent',
    });
  }
  const byId = new Map(msgs.map((m) => [m.id, m]));
  return {
    list(scope: string): Json {
      const wanted = scope.includes('in:sent') ? 'sent' : 'inbox';
      const matches = msgs.filter((m) => m.scope === wanted);
      return { messages: matches.map((m) => ({ id: m.id, threadId: m.threadId })), resultSizeEstimate: matches.length };
    },
    meta(id: string): Json | null {
      const m = byId.get(id);
      if (!m) return null;
      const headers: Array<{ name: string; value: string }> = [
        { name: 'From', value: m.scope === 'sent' ? 'You <owner@example.test>' : 'Client <client@example.test>' },
        { name: 'Date', value: new Date(m.ts).toUTCString() },
      ];
      if (m.inReplyTo) headers.push({ name: 'In-Reply-To', value: `<${m.inReplyTo}@example.test>` });
      if (m.unsubscribe) headers.push({ name: 'List-Unsubscribe', value: '<https://news.example.test/u>' });
      return { id: m.id, threadId: m.threadId, internalDate: String(m.ts), payload: { headers } };
    },
  };
}

export function gcalFixtures(nowMs: number): Json {
  const items: Json[] = [];
  for (let i = 0; i < 36; i++) {
    const start = nowMs - (2 + i * 2.4) * DAY;
    const unconfirmed = i % 3 === 0; // 12 of 36
    items.push({
      id: `ev-${i}`,
      status: 'confirmed',
      summary: `Session ${i}`,
      start: { dateTime: new Date(start).toISOString() },
      end: { dateTime: new Date(start + 90 * 60_000).toISOString() },
      attendees: [
        { email: 'owner@example.test', self: true, responseStatus: 'accepted' },
        { email: `guest-${i}@example.test`, responseStatus: unconfirmed ? 'needsAction' : 'accepted' },
      ],
    });
  }
  for (let i = 0; i < 8; i++) {
    const start = nowMs - (5 + i * 9) * DAY;
    items.push({
      id: `churn-${i}`,
      status: i % 2 === 0 ? 'cancelled' : 'confirmed',
      start: { dateTime: new Date(start).toISOString() },
      end: { dateTime: new Date(start + 60 * 60_000).toISOString() },
      attendees: [
        { email: 'owner@example.test', self: true },
        { email: `guest-c${i}@example.test`, responseStatus: i % 2 === 0 ? 'needsAction' : 'declined' },
      ],
    });
  }
  return { items };
}

export function stripeFixtures(nowMs: number): { invoices: Json; balanceTransactions: Json } {
  const nowSecs = Math.floor(nowMs / 1000);
  const invoices: Json[] = [];
  for (let i = 0; i < 14; i++) {
    const created = nowSecs - (6 + i * 6) * 86_400;
    invoices.push({
      id: `in_paid_${i}`,
      status: 'paid',
      created,
      due_date: created + 14 * 86_400,
      amount_due: 40_000 + i * 5_000,
      amount_paid: 40_000 + i * 5_000,
      customer: `cus_${i % 5}`,
      subscription: i % 3 === 0 ? `sub_${i % 5}` : null,
      status_transitions: { finalized_at: created + (i % 2 === 0 ? 4 : 5) * 86_400, paid_at: created + 16 * 86_400 },
    });
  }
  for (let i = 0; i < 3; i++) {
    const created = nowSecs - (30 + i * 12) * 86_400;
    invoices.push({
      id: `in_open_${i}`,
      status: 'open',
      created,
      due_date: created + 14 * 86_400, // past due by now
      amount_due: 65_000 + i * 30_000,
      amount_paid: 0,
      customer: `cus_o${i}`,
      subscription: null,
      status_transitions: { finalized_at: created + 4 * 86_400, paid_at: null },
    });
  }
  const txns: Json[] = [];
  for (let i = 0; i < 30; i++) {
    txns.push({ id: `txn_${i}`, fee: 310, amount: 42_000, created: nowSecs - (1 + i * 3) * 86_400 });
  }
  return {
    invoices: { data: invoices, has_more: false },
    balanceTransactions: { data: txns, has_more: false },
  };
}

export function honeybookFixtures(nowMs: number): Json {
  const projects: Json[] = [];
  for (let i = 0; i < 3; i++) {
    const created = nowMs - (5 + i * 4) * DAY;
    projects.push({ id: `hb-lead-${i}`, stage: 'inquiry', created_at: new Date(created).toISOString(), updated_at: new Date(created).toISOString() });
  }
  for (let i = 0; i < 3; i++) {
    const updated = nowMs - (18 + i * 6) * DAY;
    projects.push({ id: `hb-stall-${i}`, stage: 'proposal', created_at: new Date(updated - 20 * DAY).toISOString(), updated_at: new Date(updated).toISOString() });
  }
  for (let i = 0; i < 3; i++) {
    projects.push({ id: `hb-ok-${i}`, stage: 'completed', created_at: new Date(nowMs - 40 * DAY).toISOString(), updated_at: new Date(nowMs - 2 * DAY).toISOString() });
  }
  return { projects };
}

export function pixiesetFixtures(nowMs: number): Json {
  const data: Json[] = [];
  for (let i = 0; i < 5; i++) {
    const created = nowMs - (20 + i * 12) * DAY;
    data.push({
      id: `col-${i}`,
      created_at: new Date(created).toISOString(),
      published_at: new Date(created + (7 + i) * DAY).toISOString(),
    });
  }
  for (let i = 0; i < 3; i++) {
    data.push({ id: `col-wait-${i}`, created_at: new Date(nowMs - (10 + i * 8) * DAY).toISOString() });
  }
  return { data };
}

export function instagramFixtures(nowMs: number): { conversations: Json; messages: (id: string) => Json } {
  const me = 'ig-owner';
  const threads = new Map<string, Json[]>();
  // 5 fresh inbound conversations, 3 of them still waiting on a reply
  for (let i = 0; i < 5; i++) {
    const opened = nowMs - (3 + i * 15) * DAY;
    const msgs = [ig(`m-${i}-0`, `ig-client-${i}`, opened)];
    if (i >= 3) msgs.push(ig(`m-${i}-1`, me, opened + 5 * HOUR));
    threads.set(`convo-${i}`, msgs);
  }
  // older threads where the owner replied (establishes self id presence)
  for (let i = 5; i < 8; i++) {
    const opened = nowMs - (40 + i * 5) * DAY;
    threads.set(`convo-${i}`, [
      ig(`m-${i}-0`, `ig-client-${i}`, opened),
      ig(`m-${i}-1`, me, opened + 2 * HOUR),
    ]);
  }
  return {
    conversations: {
      data: [...threads.keys()].map((id) => ({ id, updated_time: new Date(nowMs - DAY).toISOString() })),
    },
    messages: (id: string) => ({ data: threads.get(id) ?? [] }),
  };
}

/** A ScanResourceReader serving the fixture corpus for one provider. */
export function fixtureReader(provider: string, nowMs: number): ScanResourceReader {
  const wrap = (payload: unknown, path: string): QuarantinedContent =>
    quarantine(JSON.stringify(payload), `${provider}:fixture:${path.split('?')[0]}`);

  return {
    async read(path: string): Promise<QuarantinedContent> {
      const url = new URL(path, 'https://fixture.invalid');
      const p = url.pathname;

      if (provider === 'gmail') {
        const g = gmailFixtures(nowMs);
        const m = p.match(/^\/gmail\/v1\/users\/me\/messages\/([^/]+)$/);
        if (m) return wrap(g.meta(decodeURIComponent(m[1])) ?? {}, path);
        if (p === '/gmail/v1/users/me/messages') return wrap(g.list(url.searchParams.get('q') ?? ''), path);
      }
      if (provider === 'google-calendar' && p === '/calendar/v3/calendars/primary/events') {
        return wrap(gcalFixtures(nowMs), path);
      }
      if (provider === 'stripe') {
        const s = stripeFixtures(nowMs);
        if (p === '/v1/invoices') return wrap(s.invoices, path);
        if (p === '/v1/balance_transactions') return wrap(s.balanceTransactions, path);
      }
      if (provider === 'honeybook' && p === '/v2/projects') return wrap(honeybookFixtures(nowMs), path);
      if (provider === 'pixieset' && p === '/v1/collections') return wrap(pixiesetFixtures(nowMs), path);
      if (provider === 'instagram-dm') {
        const i = instagramFixtures(nowMs);
        if (p === '/v23.0/me/conversations') return wrap(i.conversations, path);
        const m = p.match(/^\/v23\.0\/([^/]+)\/messages$/);
        if (m) return wrap(i.messages(decodeURIComponent(m[1])), path);
      }
      return wrap({}, path);
    },
  };
}

/** Providers the fixture corpus can stand in for. */
export const FIXTURE_PROVIDERS = ['gmail', 'google-calendar', 'stripe', 'honeybook', 'pixieset', 'instagram-dm'];
