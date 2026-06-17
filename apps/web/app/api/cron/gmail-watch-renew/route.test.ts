import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const SECRET = 'renew-secret';

// Shared mutable state so each test can set the rows the query returns.
const { mockState } = vi.hoisted(() => ({ mockState: { rows: [] as Record<string, unknown>[] } }));

function makeReq(authorization?: string): NextRequest {
  return new NextRequest('http://localhost/api/cron/gmail-watch-renew', {
    method: 'GET',
    headers: authorization ? { authorization } : {},
  });
}

vi.mock('../../../../lib/supabase/service', () => ({
  serviceClient: vi.fn(() => ({
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          eq: vi.fn(() => Promise.resolve({ data: mockState.rows, error: null })),
        })),
      })),
    })),
    rpc: vi.fn().mockResolvedValue({ error: null }),
  })),
}));

vi.mock('@nibbin/connectors', () => ({
  GmailClient: vi.fn(function () {
    return {
      watch: vi.fn().mockResolvedValue({ historyId: '999', expiration: String(Date.now() + 7 * 86400000) }),
    };
  }),
  SupabaseTokenVault: vi.fn(function () { return {}; }),
}));

vi.mock('../../../../lib/runtime/engine', () => ({
  connectionFromRow: vi.fn((row: Record<string, unknown>) => ({
    id: (row.id as string) ?? 'conn-1',
    accountId: (row.account_id as string) ?? 'acct-1',
    provider: 'gmail',
    webhookState: {},
    status: 'active',
    tokenRef: null,
    method: 'H',
    scopes: [],
    createdBy: null,
    createdAt: new Date(0).toISOString(),
    revokedAt: null,
  })),
}));

describe('GET /api/cron/gmail-watch-renew', () => {
  beforeEach(() => {
    process.env.CRON_SECRET = SECRET;
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
    process.env.SUPABASE_SECRET_KEY = 'test-key';
    process.env.GMAIL_PUBSUB_TOPIC = 'projects/test/topics/gmail-events';
    mockState.rows = [];
    vi.clearAllMocks();
  });

  it('returns 401 without correct secret', async () => {
    const { GET } = await import('./route');
    const res = await GET(makeReq('Bearer wrong'));
    expect(res.status).toBe(401);
  });

  it('stays inert when no Pub/Sub topic is configured', async () => {
    process.env.GMAIL_PUBSUB_TOPIC = '';
    const { GET } = await import('./route');
    const res = await GET(makeReq(`Bearer ${SECRET}`));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ skipped: 'no_topic' });
  });

  it('registers nothing when there are no active Gmail connections', async () => {
    mockState.rows = [];
    const { GET } = await import('./route');
    const res = await GET(makeReq(`Bearer ${SECRET}`));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ registered: 0, errors: [] });
  });

  it('bootstraps the FIRST watch for a connection with no watchExpiry', async () => {
    // The bug this fixes: a freshly connected inbox has empty webhook_state, so
    // watchExpiry is null and the old renew-only query skipped it forever.
    mockState.rows = [{ id: 'c1', account_id: 'a1', webhook_state: {} }];
    const { GET } = await import('./route');
    const res = await GET(makeReq(`Bearer ${SECRET}`));
    expect(await res.json()).toMatchObject({ registered: 1, errors: [] });
  });

  it('skips a connection whose watch is still well in the future', async () => {
    const future = new Date(Date.now() + 7 * 86400000).toISOString();
    mockState.rows = [{ id: 'c1', account_id: 'a1', webhook_state: { watchExpiry: future } }];
    const { GET } = await import('./route');
    const res = await GET(makeReq(`Bearer ${SECRET}`));
    expect(await res.json()).toMatchObject({ registered: 0, errors: [] });
  });

  it('renews a connection whose watch expires within 24h', async () => {
    const soon = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    mockState.rows = [{ id: 'c1', account_id: 'a1', webhook_state: { watchExpiry: soon } }];
    const { GET } = await import('./route');
    const res = await GET(makeReq(`Bearer ${SECRET}`));
    expect(await res.json()).toMatchObject({ registered: 1, errors: [] });
  });
});
