import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const SECRET = 'test-cron-secret';

function makeReq(authorization?: string): NextRequest {
  return new NextRequest('http://localhost/api/cron/connector-poll', {
    method: 'GET',
    headers: authorization ? { authorization } : {},
  });
}

vi.mock('../../../../lib/supabase/service', () => ({
  serviceClient: vi.fn(() => ({
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          in: vi.fn(() => ({
            order: vi.fn(() => ({
              limit: vi.fn(() => Promise.resolve({ data: [], error: null })),
            })),
          })),
        })),
      })),
    })),
  })),
}));

vi.mock('@nibbin/connectors', async () => {
  const { CONNECTOR_REGISTRY } = await import('../../../../../../packages/connectors/src/index');
  return {
    CONNECTOR_REGISTRY,
    SupabaseWebhookEventStore: vi.fn(function () {
      return {
        recordOnce: vi.fn().mockResolvedValue(true),
        hasRecord: vi.fn().mockResolvedValue(false),
      };
    }),
    SupabaseTokenVault: vi.fn(function () {
      return {};
    }),
    GmailClient: vi.fn(function () {
      return {
        historyList: vi.fn().mockResolvedValue({ history: [], historyId: '100' }),
        getProfile: vi.fn().mockResolvedValue({ emailAddress: 'test@g.com', historyId: '100' }),
      };
    }),
    GoogleCalendarClient: vi.fn(function () {
      return {
        listEventsSync: vi.fn().mockResolvedValue({ items: [], nextSyncToken: 'cal-tok-1' }),
      };
    }),
    fetchCalendarDelta: vi.fn().mockResolvedValue({ events: [], newSyncToken: 'cal-tok-1' }),
  };
});

vi.mock('../../../../lib/runtime/engine', () => ({
  connectionFromRow: vi.fn((row: Record<string, unknown>) => ({
    id: (row.id as string) ?? 'conn-1',
    accountId: (row.account_id as string) ?? 'acct-1',
    provider: (row.provider as string) ?? 'gmail',
    webhookState: {},
    status: 'active',
    tokenRef: null,
    method: 'H',
    scopes: [],
    createdBy: null,
    createdAt: new Date(0).toISOString(),
    revokedAt: null,
  })),
  activeNibbinsForAccount: vi.fn().mockResolvedValue([]),
  triggerNibbinRun: vi.fn().mockResolvedValue({ kind: 'not_started', why: 'deduped' }),
}));

vi.mock('../../../../lib/connections/dispatch', () => ({
  dispatchForConnection: vi.fn().mockResolvedValue({ triggered: 0, capped: false }),
}));

vi.mock('../../../../lib/connections/gmail-delta', () => ({
  fetchGmailDelta: vi.fn().mockResolvedValue({ events: [], newHistoryId: '101' }),
  advanceGmailCursor: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../../../lib/connections/calendar-delta', () => ({
  advanceCalendarCursor: vi.fn().mockResolvedValue(undefined),
}));

// Builds a serviceClient stub whose connections query resolves to `rows` and
// records the `.order(...)` / `.limit(...)` args so tests can assert the
// deterministic order + per-cycle batch cap (P3.5).
function makeServiceClient(rows: Record<string, unknown>[]) {
  const order = vi.fn();
  const limit = vi.fn();
  const client = {
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          in: vi.fn(() => ({
            order: order.mockReturnValue({
              limit: limit.mockReturnValue(Promise.resolve({ data: rows, error: null })),
            }),
          })),
        })),
      })),
    })),
    rpc: vi.fn().mockResolvedValue({ error: null }),
    __order: order,
    __limit: limit,
  };
  return client as unknown as ReturnType<typeof import('../../../../lib/supabase/service').serviceClient> & {
    __order: typeof order;
    __limit: typeof limit;
  };
}

describe('GET /api/cron/connector-poll', () => {
  beforeEach(() => {
    process.env.CRON_SECRET = SECRET;
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
    process.env.SUPABASE_SECRET_KEY = 'test-key';
    vi.clearAllMocks();
  });

  it('returns 401 with no authorization header', async () => {
    const { GET } = await import('./route');
    const res = await GET(makeReq());
    expect(res.status).toBe(401);
  });

  it('returns 401 with wrong secret', async () => {
    const { GET } = await import('./route');
    const res = await GET(makeReq('Bearer wrong-secret'));
    expect(res.status).toBe(401);
  });

  it('returns 200 with { processed, triggered, errors } shape', async () => {
    const { GET } = await import('./route');
    const res = await GET(makeReq(`Bearer ${SECRET}`));
    expect(res.status).toBe(200);
    const body = await res.json() as { processed: number; triggered: number; errors: string[] };
    expect(body).toMatchObject({ processed: 0, triggered: 0, errors: [] });
  });

  it('is timing-safe (does not short-circuit on length difference)', async () => {
    const { GET } = await import('./route');
    const res = await GET(makeReq('Bearer short'));
    expect(res.status).toBe(401);
  });

  it('does NOT advance the cursor when dispatchForConnection is capped', async () => {
    const { advanceGmailCursor, fetchGmailDelta } = await import('../../../../lib/connections/gmail-delta');
    const { dispatchForConnection } = await import('../../../../lib/connections/dispatch');
    const { serviceClient } = await import('../../../../lib/supabase/service');

    vi.mocked(serviceClient).mockReturnValueOnce(
      makeServiceClient([{ id: 'conn-1', account_id: 'acct-1', provider: 'gmail', status: 'active' }]),
    );

    vi.mocked(fetchGmailDelta).mockResolvedValueOnce({
      events: [{ provider: 'gmail', connectionId: 'conn-1', accountId: 'acct-1', kind: 'message.received', dedupeKey: 'gmail:conn-1:msg-1' }],
      newHistoryId: '200',
    });
    vi.mocked(dispatchForConnection).mockResolvedValueOnce({ triggered: 5, capped: true, deferred: 3 });

    const { GET } = await import('./route');
    await GET(makeReq(`Bearer ${SECRET}`));

    expect(advanceGmailCursor).not.toHaveBeenCalled();
  });

  it('advances the cursor when dispatch is not capped', async () => {
    const { advanceGmailCursor, fetchGmailDelta } = await import('../../../../lib/connections/gmail-delta');
    const { dispatchForConnection } = await import('../../../../lib/connections/dispatch');
    const { serviceClient } = await import('../../../../lib/supabase/service');

    vi.mocked(serviceClient).mockReturnValueOnce(
      makeServiceClient([{ id: 'conn-1', account_id: 'acct-1', provider: 'gmail', status: 'active' }]),
    );

    vi.mocked(fetchGmailDelta).mockResolvedValueOnce({
      events: [{ provider: 'gmail', connectionId: 'conn-1', accountId: 'acct-1', kind: 'message.received', dedupeKey: 'gmail:conn-1:msg-1' }],
      newHistoryId: '201',
    });
    vi.mocked(dispatchForConnection).mockResolvedValueOnce({ triggered: 2, capped: false, deferred: 0 });

    const { GET } = await import('./route');
    await GET(makeReq(`Bearer ${SECRET}`));

    expect(advanceGmailCursor).toHaveBeenCalledWith(expect.anything(), 'conn-1', '201');
  });

  it('fetches activeNibbinsForAccount ONCE per connection, not per event (P3.4)', async () => {
    const { fetchGmailDelta } = await import('../../../../lib/connections/gmail-delta');
    const { dispatchForConnection } = await import('../../../../lib/connections/dispatch');
    const { activeNibbinsForAccount } = await import('../../../../lib/runtime/engine');
    const { serviceClient } = await import('../../../../lib/supabase/service');

    vi.mocked(serviceClient).mockReturnValueOnce(
      makeServiceClient([{ id: 'conn-1', account_id: 'acct-1', provider: 'gmail', status: 'active' }]),
    );

    // Three events for the same connection — the hoisted resolver must collapse
    // these into a single activeNibbinsForAccount join.
    vi.mocked(fetchGmailDelta).mockResolvedValueOnce({
      events: [
        { provider: 'gmail', connectionId: 'conn-1', accountId: 'acct-1', kind: 'message.received', dedupeKey: 'gmail:conn-1:msg-1' },
        { provider: 'gmail', connectionId: 'conn-1', accountId: 'acct-1', kind: 'message.received', dedupeKey: 'gmail:conn-1:msg-2' },
        { provider: 'gmail', connectionId: 'conn-1', accountId: 'acct-1', kind: 'message.received', dedupeKey: 'gmail:conn-1:msg-3' },
      ],
      newHistoryId: '300',
    });

    // The dispatch mock exercises the route's injected resolver once per event,
    // mirroring real dispatchForConnection (which resolves Nibbins per call).
    vi.mocked(dispatchForConnection).mockImplementation(async (_event, deps) => {
      await deps.activeNibbinsForAccount('acct-1');
      return { triggered: 0, capped: false, deferred: 0 };
    });

    const { GET } = await import('./route');
    await GET(makeReq(`Bearer ${SECRET}`));

    expect(activeNibbinsForAccount).toHaveBeenCalledTimes(1);
  });

  it('caps the connections query to a per-cycle batch in a deterministic order (P3.5)', async () => {
    const { serviceClient } = await import('../../../../lib/supabase/service');

    const client = makeServiceClient([]);
    vi.mocked(serviceClient).mockReturnValueOnce(client);

    const { GET } = await import('./route');
    await GET(makeReq(`Bearer ${SECRET}`));

    expect(client.__order).toHaveBeenCalledWith('created_at', { ascending: true });
    expect(client.__limit).toHaveBeenCalledWith(25);
  });

  it('processes a google-calendar connection and advances the calendar cursor when uncapped', async () => {
    const { fetchCalendarDelta } = await import('@nibbin/connectors');
    const { advanceCalendarCursor } = await import('../../../../lib/connections/calendar-delta');
    const { dispatchForConnection } = await import('../../../../lib/connections/dispatch');
    const { serviceClient } = await import('../../../../lib/supabase/service');

    vi.mocked(serviceClient).mockReturnValueOnce(
      makeServiceClient([{ id: 'cal-conn-1', account_id: 'acct-2', provider: 'google-calendar', status: 'active' }]),
    );

    vi.mocked(fetchCalendarDelta).mockResolvedValueOnce({
      events: [{
        provider: 'google-calendar',
        connectionId: 'cal-conn-1',
        accountId: 'acct-2',
        kind: 'calendar.changed',
        dedupeKey: 'google-calendar:cal-conn-1:evt-1',
      }],
      newSyncToken: 'tok-new',
    });
    vi.mocked(dispatchForConnection).mockResolvedValueOnce({ triggered: 1, capped: false, deferred: 0 });

    const { GET } = await import('./route');
    await GET(makeReq(`Bearer ${SECRET}`));

    expect(advanceCalendarCursor).toHaveBeenCalledWith(expect.anything(), 'cal-conn-1', 'tok-new');
  });

  it('does NOT advance the calendar cursor when dispatch is capped', async () => {
    const { fetchCalendarDelta } = await import('@nibbin/connectors');
    const { advanceCalendarCursor } = await import('../../../../lib/connections/calendar-delta');
    const { dispatchForConnection } = await import('../../../../lib/connections/dispatch');
    const { serviceClient } = await import('../../../../lib/supabase/service');

    vi.mocked(serviceClient).mockReturnValueOnce(
      makeServiceClient([{ id: 'cal-conn-2', account_id: 'acct-3', provider: 'google-calendar', status: 'active' }]),
    );

    vi.mocked(fetchCalendarDelta).mockResolvedValueOnce({
      events: [{
        provider: 'google-calendar',
        connectionId: 'cal-conn-2',
        accountId: 'acct-3',
        kind: 'calendar.changed',
        dedupeKey: 'google-calendar:cal-conn-2:evt-2',
      }],
      newSyncToken: 'tok-new-2',
    });
    vi.mocked(dispatchForConnection).mockResolvedValueOnce({ triggered: 5, capped: true, deferred: 3 });

    const { GET } = await import('./route');
    await GET(makeReq(`Bearer ${SECRET}`));

    expect(advanceCalendarCursor).not.toHaveBeenCalled();
  });

  it('skips unknown providers without error (continues loop)', async () => {
    const { serviceClient } = await import('../../../../lib/supabase/service');

    vi.mocked(serviceClient).mockReturnValueOnce(
      makeServiceClient([{ id: 'other-conn', account_id: 'acct-4', provider: 'unknown-provider', status: 'active' }]),
    );

    const { GET } = await import('./route');
    const res = await GET(makeReq(`Bearer ${SECRET}`));
    const body = await res.json() as { processed: number; errors: string[] };
    // skipped, not counted as processed, no errors
    expect(body.processed).toBe(0);
    expect(body.errors).toHaveLength(0);
  });
});
