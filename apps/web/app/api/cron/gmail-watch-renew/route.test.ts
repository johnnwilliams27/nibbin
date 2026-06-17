import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const SECRET = 'renew-secret';

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
          eq: vi.fn(() => ({
            lt: vi.fn(() => Promise.resolve({ data: [], error: null })),
          })),
        })),
      })),
    })),
    rpc: vi.fn().mockResolvedValue({ error: null }),
  })),
}));

vi.mock('@nibbin/connectors', () => ({
  GmailClient: vi.fn(function () {
    return {
      watch: vi.fn().mockResolvedValue({ historyId: '999', expiration: String(Date.now() + 86400000) }),
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
    vi.clearAllMocks();
  });

  it('returns 401 without correct secret', async () => {
    const { GET } = await import('./route');
    const res = await GET(makeReq('Bearer wrong'));
    expect(res.status).toBe(401);
  });

  it('returns { renewed, errors } with zero renewals when no connections are expiring', async () => {
    const { GET } = await import('./route');
    const res = await GET(makeReq(`Bearer ${SECRET}`));
    expect(res.status).toBe(200);
    const body = await res.json() as { renewed: number; errors: string[] };
    expect(body).toMatchObject({ renewed: 0, errors: [] });
  });
});
