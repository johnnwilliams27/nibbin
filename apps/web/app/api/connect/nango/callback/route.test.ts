/**
 * Task 9 TDD — POST /api/connect/nango/callback
 *
 * Covers:
 *  - Valid Nango auth webhook with NO pre-existing row INSERTs a new active method:'N' row (C1)
 *  - Valid Nango auth webhook with an existing non-revoked row UPDATEs it (no duplicate insert)
 *  - Reconnect: existing revoked row + valid callback → new INSERT (F-A)
 *  - Replay: idempotent — second valid callback on already-active row updates without error
 *  - Webhook signature verification (unsigned / bad sig → 401)
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

const {
  updateSpy,
  insertSingleFn,
  insertSpy,
  maybeSingleFn,
  gmailWatchSpy,
  calendarWatchSpy,
  verifyWebhookSpy,
  getConnectionSpy,
} = vi.hoisted(() => {
  // update chain: .update(payload).eq('id', id)
  const updateEqFn = vi.fn(() => Promise.resolve({ error: null }));
  const updateSpy = vi.fn(() => ({ eq: updateEqFn }));

  // insert chain: .insert(payload).select('id').single()
  const insertSingleFn = vi.fn(async () => ({
    data: { id: 'new-conn-uuid' } as Record<string, unknown> | null,
    error: null,
  }));
  const insertSelectFn = vi.fn(() => ({ single: insertSingleFn }));
  const insertSpy = vi.fn(() => ({ select: insertSelectFn }));

  // select chain: .select('id').eq().eq().neq().maybeSingle()
  const maybeSingleFn = vi.fn(async () => ({
    data: null as Record<string, unknown> | null,
    error: null,
  }));

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
  (verifyWebhookSpy as unknown as { _setKey: (k: string) => void })._setKey = (k: string) => {
    signingKey = k;
  };

  const getConnectionSpy = vi.fn(async () => ({
    credentials: {
      raw: { scope: 'https://www.googleapis.com/auth/gmail.readonly https://mail.google.com/' },
    },
  }));

  return {
    updateSpy,
    insertSingleFn,
    insertSpy,
    maybeSingleFn,
    gmailWatchSpy,
    calendarWatchSpy,
    verifyWebhookSpy,
    getConnectionSpy,
  };
});

// ── vi.mock declarations ─────────────────────────────────────────────────────

vi.mock('server-only', () => ({}));

vi.mock('../../../../../lib/supabase/service', () => ({
  serviceClient: vi.fn(() => ({
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          eq: vi.fn(() => ({
            neq: vi.fn(() => ({
              maybeSingle: maybySingleProxy,
            })),
          })),
        })),
      })),
      update: updateSpy,
      insert: insertSpy,
    })),
  })),
}));

// Thin proxy so maybeSingleFn is swappable per-test.
function maybySingleProxy() {
  return maybeSingleFn();
}

vi.mock('../../../../../lib/connectors/nango', () => ({
  getNango: vi.fn(() => ({
    verifyIncomingWebhookRequest: verifyWebhookSpy,
    getConnection: getConnectionSpy,
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

function existingRow(
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
    // Default: no pre-existing non-revoked row (covers the C1 insert path)
    maybeSingleFn.mockResolvedValue({ data: null, error: null });
    // Default insert returns a new row id
    insertSingleFn.mockResolvedValue({ data: { id: 'new-conn-uuid' }, error: null });
    process.env.NANGO_WEBHOOK_SIGNING_KEY = WEBHOOK_SIGNING_KEY;
    process.env.GMAIL_PUBSUB_TOPIC = GMAIL_PUBSUB_TOPIC;
    process.env.CALENDAR_WEBHOOK_ADDRESS = CALENDAR_CHANNEL_ADDR;
    process.env.CALENDAR_WEBHOOK_TOKEN = CALENDAR_CHANNEL_TOKEN;
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
    process.env.SUPABASE_SECRET_KEY = 'test-key';
    (verifyWebhookSpy as unknown as { _setKey: (k: string) => void })._setKey(WEBHOOK_SIGNING_KEY);
    getConnectionSpy.mockResolvedValue({
      credentials: {
        raw: { scope: 'https://www.googleapis.com/auth/gmail.readonly https://mail.google.com/' },
      },
    });
  });

  // ── C1: first-time connect — NO pre-existing row → INSERT ─────────────────

  it('INSERTs a new active method:N connections row when no pre-existing row exists (C1 fix)', async () => {
    // maybeSingleFn returns null — no pre-existing row (default from beforeEach)

    const { POST } = await import('./route');
    const req = makeRequest(makeAuthEvent());
    const res = await POST(req);
    expect(res.status).toBe(200);

    // Must INSERT, not UPDATE
    expect(insertSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        account_id: 'acc-123',
        provider: 'gmail',
        method: 'N',
        nango_connection_id: 'nibbin-acc-123-gmail',
        nango_provider_config_key: 'google-mail',
        status: 'active',
        scopes: expect.arrayContaining(['https://www.googleapis.com/auth/gmail.readonly']),
      }),
    );
    expect(updateSpy).not.toHaveBeenCalled();
  });

  // ── UPDATE path: existing non-revoked row → UPDATE ───────────────────────

  it('UPDATEs an existing non-revoked row (no duplicate insert)', async () => {
    maybeSingleFn.mockResolvedValueOnce({ data: existingRow({ id: 'conn-uuid-001' }), error: null });

    const { POST } = await import('./route');
    const req = makeRequest(makeAuthEvent());
    const res = await POST(req);
    expect(res.status).toBe(200);

    // Must UPDATE, not INSERT
    expect(updateSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        nango_connection_id: 'nibbin-acc-123-gmail',
        nango_provider_config_key: 'google-mail',
        status: 'active',
        scopes: expect.arrayContaining(['https://www.googleapis.com/auth/gmail.readonly']),
      }),
    );
    expect(insertSpy).not.toHaveBeenCalled();
  });

  // ── F-A: reconnect after revoke — revoked row is ignored → INSERT ─────────

  it('INSERTs a new row on reconnect when only a revoked row exists (F-A fix)', async () => {
    // The lookup uses .neq('status','revoked') so it returns null even though a
    // revoked row exists in the DB — the mock simulates this correctly.
    maybeSingleFn.mockResolvedValueOnce({ data: null, error: null });

    const { POST } = await import('./route');
    const req = makeRequest(makeAuthEvent());
    const res = await POST(req);
    expect(res.status).toBe(200);

    // Reconnect should INSERT a fresh row, not 400
    expect(insertSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        account_id: 'acc-123',
        provider: 'gmail',
        method: 'N',
        status: 'active',
      }),
    );
    expect(updateSpy).not.toHaveBeenCalled();
  });

  // ── Idempotency: replay of valid callback on already-active row ───────────

  it('is idempotent: replayed callback with already-active row updates without error or duplicate insert', async () => {
    maybeSingleFn.mockResolvedValueOnce({
      data: existingRow({
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
    expect(updateSpy).toHaveBeenCalledTimes(1);
    expect(insertSpy).not.toHaveBeenCalled();
  });

  // ── Webhook signature validation ──────────────────────────────────────────

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
    (verifyWebhookSpy as unknown as { _setKey: (k: string) => void })._setKey('');

    const { POST } = await import('./route');
    const req = makeRequest(makeAuthEvent());
    const res = await POST(req);
    expect(res.status).toBe(401);
  });

  // ── Non-auth events → 200 no-op ──────────────────────────────────────────

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
    expect(updateSpy).not.toHaveBeenCalled();
    expect(insertSpy).not.toHaveBeenCalled();
  });

  // ── Auth failure → 200 no-op ──────────────────────────────────────────────

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
    expect(insertSpy).not.toHaveBeenCalled();
  });

  // ── Gmail watch() triggered ───────────────────────────────────────────────

  it('calls gmail.watch(topicName) after successful connect for gmail (insert path)', async () => {
    // No pre-existing row → INSERT path
    const { POST } = await import('./route');
    const req = makeRequest(makeAuthEvent());
    const res = await POST(req);
    expect(res.status).toBe(200);
    expect(gmailWatchSpy).toHaveBeenCalledWith(GMAIL_PUBSUB_TOPIC);
  });

  it('calls gmail.watch(topicName) after successful connect for gmail (update path)', async () => {
    maybeSingleFn.mockResolvedValueOnce({ data: existingRow(), error: null });

    const { POST } = await import('./route');
    const req = makeRequest(makeAuthEvent());
    const res = await POST(req);
    expect(res.status).toBe(200);
    expect(gmailWatchSpy).toHaveBeenCalledWith(GMAIL_PUBSUB_TOPIC);
  });

  // ── Google Calendar watchEvents() triggered ────────────────────────────────

  it('calls calendarClient.watchEvents() after successful connect for google-calendar', async () => {
    getConnectionSpy.mockResolvedValueOnce({
      credentials: {
        raw: {
          scope: 'https://www.googleapis.com/auth/calendar.readonly https://www.googleapis.com/auth/calendar.events',
        },
      },
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

  // ── Watch failure is non-fatal ─────────────────────────────────────────────

  it('returns 200 even when watch() throws — row write is the critical step', async () => {
    gmailWatchSpy.mockRejectedValueOnce(new Error('pubsub quota exceeded'));

    const { POST } = await import('./route');
    const req = makeRequest(makeAuthEvent());
    const res = await POST(req);
    // Row write (insert) succeeded; watch failure must not surface as a 5xx
    expect(res.status).toBe(200);
    // Insert still happened
    expect(insertSpy).toHaveBeenCalledTimes(1);
  });
});
