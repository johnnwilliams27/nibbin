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
          in: vi.fn(() => Promise.resolve({ data: [], error: null })),
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
      return { recordOnce: vi.fn().mockResolvedValue(true) };
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

    vi.mocked(serviceClient).mockReturnValueOnce({
      from: vi.fn(() => ({
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            in: vi.fn(() =>
              Promise.resolve({
                data: [{ id: 'conn-1', account_id: 'acct-1', provider: 'gmail', status: 'active' }],
                error: null,
              }),
            ),
          })),
        })),
      })),
      rpc: vi.fn().mockResolvedValue({ error: null }),
    } as unknown as ReturnType<typeof serviceClient>);

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

    vi.mocked(serviceClient).mockReturnValueOnce({
      from: vi.fn(() => ({
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            in: vi.fn(() =>
              Promise.resolve({
                data: [{ id: 'conn-1', account_id: 'acct-1', provider: 'gmail', status: 'active' }],
                error: null,
              }),
            ),
          })),
        })),
      })),
      rpc: vi.fn().mockResolvedValue({ error: null }),
    } as unknown as ReturnType<typeof serviceClient>);

    vi.mocked(fetchGmailDelta).mockResolvedValueOnce({
      events: [{ provider: 'gmail', connectionId: 'conn-1', accountId: 'acct-1', kind: 'message.received', dedupeKey: 'gmail:conn-1:msg-1' }],
      newHistoryId: '201',
    });
    vi.mocked(dispatchForConnection).mockResolvedValueOnce({ triggered: 2, capped: false, deferred: 0 });

    const { GET } = await import('./route');
    await GET(makeReq(`Bearer ${SECRET}`));

    expect(advanceGmailCursor).toHaveBeenCalledWith(expect.anything(), 'conn-1', '201');
  });
});
