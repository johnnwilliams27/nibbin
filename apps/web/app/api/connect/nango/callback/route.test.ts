/**
 * Task 9 TDD — POST /api/connect/nango/callback
 *
 * Covers:
 *  - Valid Nango auth webhook writes nango_connection_id + nango_provider_config_key
 *    + scopes + status=active to the connections row
 *  - Webhook signature verification (unsigned / bad sig → 401)
 *  - Unknown connectionId → 400 (no matching connection row)
 *  - Idempotency: replayed valid callback upserts without error
 *  - Non-auth type events (e.g. 'sync') → 200 no-op
 *  - Auth failure event (success:false) → 200 no-op
 *  - Gmail: watch() triggered on successful callback
 *  - Google Calendar: watchEvents() triggered on successful callback
 *  - Watch failure is non-fatal (row write is the critical step)
 *
 * Test file is colocated with route.ts (same directory) so relative import
 * paths in vi.mock() resolve identically to how route.ts imports them.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createHmac } from 'node:crypto';
import { NextRequest } from 'next/server';
import type { NangoAuthWebhookBodySuccess } from '@nangohq/types';

// ── constants ────────────────────────────────────────────────────────────────

const WEBHOOK_SIGNING_KEY = 'test-webhook-signing-key';
const GMAIL_PUBSUB_TOPIC = 'projects/nibbin/topics/gmail-events';
const CALENDAR_CHANNEL_ADDR = 'https://app.nibbin.com/api/webhooks/calendar';
const CALENDAR_CHANNEL_TOKEN = 'cal-token-test';

// ── hoisted shared mocks ─────────────────────────────────────────────────────

const { updateSpy, maybeSingleFn, gmailWatchSpy, calendarWatchSpy, verifyWebhookSpy, getConnectionSpy } =
  vi.hoisted(() => {
    const updateEqFn = vi.fn(() => Promise.resolve({ error: null }));
    const updateSpy = vi.fn(() => ({ eq: updateEqFn }));

    const maybeSingleFn = vi.fn(async () => ({ data: null as Record<string, unknown> | null, error: null }));

    const gmailWatchSpy = vi.fn(async (_topic: string) => ({
      historyId: '100',
      expiration: String(Date.now() + 7 * 86400000),
    }));
    const calendarWatchSpy = vi.fn(async () => ({}));

    let signingKey = 'test-webhook-signing-key';
    const verifyWebhookSpy = vi.fn((rawBody: string, headers: Record<string, unknown>) => {
      if (!signingKey) return false;
      const sig = createHmac('sha256', signingKey).update(rawBody).digest('hex');
      const headerSig = headers['x-nango-hmac-sha256'];
      return typeof headerSig === 'string' && headerSig === sig;
    });
    // Expose the key mutator for the "no signing key" test
    (verifyWebhookSpy as unknown as { _setKey: (k: string) => void })._setKey = (k: string) => {
      signingKey = k;
    };

    const getConnectionSpy = vi.fn(async () => ({
      credentials: {
        raw: { scope: 'https://www.googleapis.com/auth/gmail.readonly https://mail.google.com/' },
      },
    }));

    return { updateSpy, maybeSingleFn, gmailWatchSpy, calendarWatchSpy, verifyWebhookSpy, getConnectionSpy };
  });

// ── vi.mock declarations ─────────────────────────────────────────────────────

vi.mock('server-only', () => ({}));

vi.mock('../../../../../lib/supabase/service', () => ({
  serviceClient: vi.fn(() => ({
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          eq: vi.fn(() => ({
            maybeSingle: maybySingleProxy,
          })),
        })),
      })),
      update: updateSpy,
    })),
  })),
}));

// We need a thin proxy because vi.hoisted runs before vi.mock factories, but
// maybeSingleFn needs to be swappable per-test. Use a stable wrapper.
function maybySingleProxy() {
  return maybeSingleFn();
}

vi.mock('../../../../../lib/connectors/nango', () => ({
  getNango: vi.fn(() => ({
    verifyIncomingWebhookRequest: verifyWebhookSpy,
    getConnection: getConnectionSpy,
  })),
}));

vi.mock('../../../../../lib/runtime/engine', () => ({
  connectionFromRow: vi.fn((row: Record<string, unknown>) => ({
    id: row.id as string,
    accountId: row.account_id as string,
    provider: row.provider as string,
    method: (row.method ?? 'N') as 'N',
    scopes: (row.scopes as string[]) ?? [],
    status: row.status as string,
    tokenRef: null,
    webhookState: {},
    createdBy: null,
    createdAt: new Date(0).toISOString(),
    revokedAt: null,
    nangoConnectionId: (row.nango_connection_id as string | null) ?? null,
    nangoProviderConfigKey: (row.nango_provider_config_key as string | null) ?? null,
  })),
}));

vi.mock('@nibbin/connectors', () => ({
  makeGmailClient: vi.fn(() => ({
    watch: gmailWatchSpy,
    getProfile: vi.fn(async () => ({ emailAddress: 'user@gmail.com', historyId: '1' })),
  })),
  makeGoogleCalendarClient: vi.fn(() => ({
    watchEvents: calendarWatchSpy,
  })),
  getConnector: vi.fn((provider: string) => ({
    provider,
    method: 'N',
    egressAllowlist: ['googleapis.com'],
  })),
}));

// ── helpers ──────────────────────────────────────────────────────────────────

function makeRequest(
  body: object,
  opts: { skipSignature?: boolean; badSignature?: boolean } = {},
): NextRequest {
  const rawBody = JSON.stringify(body);
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (!opts.skipSignature) {
    const sig = opts.badSignature
      ? 'badbadbadbadbadbadbadbadbadbadbadbadbadbadbadbadbadbadbadbadbadbad'
      : createHmac('sha256', WEBHOOK_SIGNING_KEY).update(rawBody).digest('hex');
    headers['x-nango-hmac-sha256'] = sig;
  }
  return new NextRequest('http://localhost/api/connect/nango/callback', {
    method: 'POST',
    headers,
    body: rawBody,
  });
}

function makeAuthEvent(
  overrides: Partial<NangoAuthWebhookBodySuccess> = {},
): NangoAuthWebhookBodySuccess {
  return {
    from: 'nango',
    type: 'auth',
    connectionId: 'nibbin-acc-123-gmail',
    providerConfigKey: 'google-mail',
    provider: 'google',
    authMode: 'OAUTH2',
    environment: 'development',
    operation: 'creation',
    success: true,
    ...overrides,
  };
}

function pendingGmailRow(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id: 'conn-uuid-001',
    account_id: 'acc-123',
    provider: 'gmail',
    method: 'N',
    status: 'pending',
    scopes: [],
    nango_connection_id: null,
    nango_provider_config_key: null,
    ...overrides,
  };
}

// ── tests ────────────────────────────────────────────────────────────────────

describe('POST /api/connect/nango/callback', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    maybeSingleFn.mockResolvedValue({ data: null, error: null });
    process.env.NANGO_WEBHOOK_SIGNING_KEY = WEBHOOK_SIGNING_KEY;
    process.env.GMAIL_PUBSUB_TOPIC = GMAIL_PUBSUB_TOPIC;
    process.env.CALENDAR_WEBHOOK_ADDRESS = CALENDAR_CHANNEL_ADDR;
    process.env.CALENDAR_WEBHOOK_TOKEN = CALENDAR_CHANNEL_TOKEN;
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
    process.env.SUPABASE_SECRET_KEY = 'test-key';
    // Reset verifyWebhookSpy signing key
    (verifyWebhookSpy as unknown as { _setKey: (k: string) => void })._setKey(WEBHOOK_SIGNING_KEY);
    // Reset getConnection to gmail scopes
    getConnectionSpy.mockResolvedValue({
      credentials: {
        raw: { scope: 'https://www.googleapis.com/auth/gmail.readonly https://mail.google.com/' },
      },
    });
  });

  // ── a. Valid event writes nango ids + scopes + status=active ──────────────

  it('writes nango_connection_id + nango_provider_config_key + scopes + status=active on valid auth event', async () => {
    maybeSingleFn.mockResolvedValueOnce({ data: pendingGmailRow(), error: null });

    const { POST } = await import('./route');
    const req = makeRequest(makeAuthEvent());
    const res = await POST(req);
    expect(res.status).toBe(200);

    expect(updateSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        nango_connection_id: 'nibbin-acc-123-gmail',
        nango_provider_config_key: 'google-mail',
        status: 'active',
        scopes: expect.arrayContaining([
          'https://www.googleapis.com/auth/gmail.readonly',
        ]),
      }),
    );
  });

  // ── b. Unknown connectionId → 400 ────────────────────────────────────────

  it('returns 400 when connectionId does not match any connection row', async () => {
    maybeSingleFn.mockResolvedValueOnce({ data: null, error: null });

    const { POST } = await import('./route');
    const req = makeRequest(makeAuthEvent({ connectionId: 'nibbin-unknown-account-gmail' }));
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  // ── c. Webhook signature validation ──────────────────────────────────────

  it('returns 401 when X-Nango-Hmac-Sha256 header is absent', async () => {
    const { POST } = await import('./route');
    const req = makeRequest(makeAuthEvent(), { skipSignature: true });
    const res = await POST(req);
    expect(res.status).toBe(401);
  });

  it('returns 401 when signature is incorrect', async () => {
    const { POST } = await import('./route');
    const req = makeRequest(makeAuthEvent(), { badSignature: true });
    const res = await POST(req);
    expect(res.status).toBe(401);
  });

  it('returns 401 when NANGO_WEBHOOK_SIGNING_KEY is not set (verifyIncomingWebhookRequest returns false)', async () => {
    // Simulate no signing key: the verifyWebhookSpy returns false
    (verifyWebhookSpy as unknown as { _setKey: (k: string) => void })._setKey('');

    const { POST } = await import('./route');
    const req = makeRequest(makeAuthEvent());
    const res = await POST(req);
    expect(res.status).toBe(401);
  });

  // ── d. Idempotency ────────────────────────────────────────────────────────

  it('is idempotent: replayed callback with already-active row upserts safely without error', async () => {
    maybeSingleFn.mockResolvedValueOnce({
      data: pendingGmailRow({
        status: 'active',
        nango_connection_id: 'nibbin-acc-123-gmail',
        nango_provider_config_key: 'google-mail',
        scopes: ['https://www.googleapis.com/auth/gmail.readonly'],
      }),
      error: null,
    });

    const { POST } = await import('./route');
    const req = makeRequest(makeAuthEvent());
    const res = await POST(req);
    expect(res.status).toBe(200);
    // upsert runs once (idempotent) — update called exactly once
    expect(updateSpy).toHaveBeenCalledTimes(1);
  });

  // ── e. Non-auth events → 200 no-op ───────────────────────────────────────

  it('returns 200 no-op for type=sync events', async () => {
    const { POST } = await import('./route');
    const syncEvent = {
      from: 'nango',
      type: 'sync',
      connectionId: 'nibbin-acc-123-gmail',
      providerConfigKey: 'google-mail',
      syncName: 'gmail-sync',
      syncVariant: 'default',
      model: 'GmailMessage',
      syncType: 'INCREMENTAL',
      success: true,
      modifiedAfter: new Date().toISOString(),
      queryTimeStamp: null,
      responseResults: { added: 0, updated: 0, deleted: 0 },
    };
    const req = makeRequest(syncEvent);
    const res = await POST(req);
    expect(res.status).toBe(200);
    // No DB write, no watch
    expect(updateSpy).not.toHaveBeenCalled();
  });

  // ── f. Auth failure → 200 no-op ──────────────────────────────────────────

  it('returns 200 no-op for auth failure events (success:false)', async () => {
    const { POST } = await import('./route');
    const failEvent = {
      ...makeAuthEvent(),
      success: false,
      error: { type: 'auth_error', description: 'User denied', payload: {} },
    };
    const req = makeRequest(failEvent);
    const res = await POST(req);
    expect(res.status).toBe(200);
    expect(updateSpy).not.toHaveBeenCalled();
  });

  // ── g. Gmail watch() triggered ────────────────────────────────────────────

  it('calls gmail.watch(topicName) after successful connect for gmail', async () => {
    maybeSingleFn.mockResolvedValueOnce({ data: pendingGmailRow(), error: null });

    const { POST } = await import('./route');
    const req = makeRequest(makeAuthEvent());
    const res = await POST(req);
    expect(res.status).toBe(200);
    expect(gmailWatchSpy).toHaveBeenCalledWith(GMAIL_PUBSUB_TOPIC);
  });

  // ── h. Google Calendar watchEvents() triggered ────────────────────────────

  it('calls calendarClient.watchEvents() after successful connect for google-calendar', async () => {
    getConnectionSpy.mockResolvedValueOnce({
      credentials: {
        raw: {
          scope: 'https://www.googleapis.com/auth/calendar.readonly https://www.googleapis.com/auth/calendar.events',
        },
      },
    });
    maybeSingleFn.mockResolvedValueOnce({
      data: pendingGmailRow({
        provider: 'google-calendar',
        account_id: 'acc-123',
      }),
      error: null,
    });

    const { POST } = await import('./route');
    const req = makeRequest(
      makeAuthEvent({
        connectionId: 'nibbin-acc-123-google-calendar',
        providerConfigKey: 'google-calendar',
      }),
    );
    const res = await POST(req);
    expect(res.status).toBe(200);
    expect(calendarWatchSpy).toHaveBeenCalled();
  });

  // ── i. Watch failure is non-fatal ─────────────────────────────────────────

  it('returns 200 even when watch() throws — row write is the critical step', async () => {
    gmailWatchSpy.mockRejectedValueOnce(new Error('pubsub quota exceeded'));
    maybeSingleFn.mockResolvedValueOnce({ data: pendingGmailRow(), error: null });

    const { POST } = await import('./route');
    const req = makeRequest(makeAuthEvent());
    const res = await POST(req);
    // Row write succeeded; watch failure must not surface as a 5xx
    expect(res.status).toBe(200);
    // But the row update still happened
    expect(updateSpy).toHaveBeenCalledTimes(1);
  });
});
