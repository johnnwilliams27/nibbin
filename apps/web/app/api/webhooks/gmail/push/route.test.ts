import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

function makeBody(emailAddress: string, historyId: string): string {
  const data = Buffer.from(JSON.stringify({ emailAddress, historyId })).toString('base64');
  return JSON.stringify({ message: { data, messageId: 'pub-1' } });
}

// Mock push-verify shim so we can control OIDC outcome in tests
vi.mock('../../../../../lib/connections/push-verify', () => ({
  verifyPubSubRequest: vi.fn().mockResolvedValue({ valid: false, reason: 'no bearer token' }),
}));

vi.mock('../../../../../lib/supabase/service', () => ({
  serviceClient: vi.fn(() => ({
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          eq: vi.fn(() => ({
            contains: vi.fn(() => Promise.resolve({ data: [], error: null })),
          })),
        })),
      })),
    })),
  })),
}));

vi.mock('@nibbin/connectors', () => ({
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
}));

vi.mock('../../../../../lib/runtime/engine', () => ({
  connectionFromRow: vi.fn((row: Record<string, unknown>) => row),
  activeNibbinsForAccount: vi.fn().mockResolvedValue([]),
  triggerNibbinRun: vi.fn().mockResolvedValue({ kind: 'not_started', why: 'deduped' }),
}));

vi.mock('../../../../../lib/connections/dispatch', () => ({
  dispatchForConnection: vi.fn().mockResolvedValue({ triggered: 0, capped: false }),
}));

vi.mock('../../../../../lib/connections/gmail-delta', () => ({
  fetchGmailDelta: vi.fn().mockResolvedValue({ events: [], newHistoryId: '101' }),
  advanceGmailCursor: vi.fn().mockResolvedValue(undefined),
}));

describe('POST /api/webhooks/gmail/push', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
    process.env.SUPABASE_SECRET_KEY = 'test-key';
  });

  it('returns 401 when Authorization header is missing (OIDC verify fails)', async () => {
    const { POST } = await import('./route');
    const req = new NextRequest('http://localhost/api/webhooks/gmail/push', {
      method: 'POST',
      body: makeBody('u@g.com', '99'),
    });
    const res = await POST(req);
    expect(res.status).toBe(401);
  });

  it('returns 200 and no-ops when connection not found for emailAddress', async () => {
    const { verifyPubSubRequest } = await import('../../../../../lib/connections/push-verify');
    vi.mocked(verifyPubSubRequest).mockResolvedValueOnce({ valid: true });

    const { POST } = await import('./route');
    const req = new NextRequest('http://localhost/api/webhooks/gmail/push', {
      method: 'POST',
      headers: { authorization: 'Bearer fake-jwt' },
      body: makeBody('unknown@g.com', '99'),
    });
    const res = await POST(req);
    // No connection found → 200 no-op (don't leak info)
    expect(res.status).toBe(200);
  });
});
