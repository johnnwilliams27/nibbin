/**
 * SMS webhook route — STOP/HELP/opt-out handler tests (Plan 06, Task 3).
 *
 * Strategy: vi.mock the three side-effecting modules so tests run without
 * Supabase, Twilio, or any real network. verifyTwilioSignature is also mocked
 * so we can control whether it passes or fails without HMAC arithmetic.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Module-level mocks (hoisted) ──────────────────────────────────────────────

vi.mock('@nibbin/channels', async (importOriginal) => {
  const real = await importOriginal<typeof import('@nibbin/channels')>();
  return {
    ...real,
    // Override only the signature checker; keep keyword matchers + copy real.
    verifyTwilioSignature: vi.fn(() => true),
  };
});

vi.mock('../../../../lib/channels/ingest', () => ({
  ingestInbound: vi.fn(async () => ({ status: 'accepted' })),
}));

vi.mock('../../../../lib/channels/ingest-deps', () => ({
  supabaseIngestDeps: vi.fn(() => ({})),
}));

vi.mock('../../../../lib/channels/sms-compliance', () => ({
  optOutSms: vi.fn(async () => undefined),
  optInSms: vi.fn(async () => undefined),
}));

// ── Imports after mocks ───────────────────────────────────────────────────────

import { POST } from './route';
import { verifyTwilioSignature, SMS_STOP_REPLY, SMS_HELP_REPLY, SMS_START_REPLY, type InboundResult } from '@nibbin/channels';
import { ingestInbound } from '../../../../lib/channels/ingest';
import { optOutSms, optInSms } from '../../../../lib/channels/sms-compliance';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeRequest(body: string, overrideHeaders: Record<string, string> = {}): Request {
  return new Request('https://example.com/api/channels/sms', {
    method: 'POST',
    body,
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      'x-twilio-signature': 'valid-sig',
      ...overrideHeaders,
    },
  });
}

function encodeParams(params: Record<string, string>): string {
  return new URLSearchParams(params).toString();
}

// ── Env setup ─────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  process.env.CHANNELS_SMS_ENABLED = 'true';
  process.env.TWILIO_AUTH_TOKEN = 'test-token';
  process.env.SMS_WEBHOOK_URL = 'https://example.com/api/channels/sms';
  vi.mocked(verifyTwilioSignature).mockReturnValue(true);
  vi.mocked(ingestInbound).mockResolvedValue({ status: 'accepted' } as InboundResult);
  vi.mocked(optOutSms).mockResolvedValue(undefined);
  vi.mocked(optInSms).mockResolvedValue(undefined);
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('POST /api/channels/sms — disabled guard', () => {
  it('returns 503 when CHANNELS_SMS_ENABLED is not true', async () => {
    process.env.CHANNELS_SMS_ENABLED = 'false';
    const res = await POST(makeRequest(encodeParams({ From: '+15550000001', Body: 'hello' })));
    expect(res.status).toBe(503);
    expect(vi.mocked(ingestInbound)).not.toHaveBeenCalled();
    expect(vi.mocked(optOutSms)).not.toHaveBeenCalled();
  });
});

describe('POST /api/channels/sms — signature verification', () => {
  it('returns 401 when the Twilio signature is invalid', async () => {
    vi.mocked(verifyTwilioSignature).mockReturnValue(false);
    const res = await POST(makeRequest(encodeParams({ From: '+15550000001', Body: 'hello' })));
    expect(res.status).toBe(401);
    expect(vi.mocked(ingestInbound)).not.toHaveBeenCalled();
    expect(vi.mocked(optOutSms)).not.toHaveBeenCalled();
  });

  it('returns 401 when x-twilio-signature header is missing', async () => {
    // Real verifyTwilioSignature returns false for null header — mock it to reflect this.
    vi.mocked(verifyTwilioSignature).mockReturnValue(false);
    const res = await POST(makeRequest(encodeParams({ From: '+15550000001', Body: 'STOP' }), {
      'x-twilio-signature': '',
    }));
    expect(res.status).toBe(401);
  });
});

describe('POST /api/channels/sms — STOP keyword (TCPA opt-out)', () => {
  const STOP_VARIANTS = ['STOP', 'stop', 'Stop', 'STOPALL', 'UNSUBSCRIBE', 'CANCEL', 'END', 'QUIT'];

  for (const kw of STOP_VARIANTS) {
    it(`"${kw}" → calls optOutSms, returns TwiML with stop reply, does NOT ingest`, async () => {
      const body = encodeParams({ From: '+15550000001', Body: kw });
      const res = await POST(makeRequest(body));

      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toBe('text/xml');

      const text = await res.text();
      expect(text).toContain(SMS_STOP_REPLY);
      expect(text).toContain('<Response>');
      expect(text).toContain('<Message>');

      expect(vi.mocked(optOutSms)).toHaveBeenCalledWith('+15550000001');
      expect(vi.mocked(ingestInbound)).not.toHaveBeenCalled();
    });
  }

  it('STOP with leading/trailing spaces is still treated as opt-out', async () => {
    const body = encodeParams({ From: '+15550000002', Body: '  STOP  ' });
    const res = await POST(makeRequest(body));
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain(SMS_STOP_REPLY);
    expect(vi.mocked(optOutSms)).toHaveBeenCalledWith('+15550000002');
    expect(vi.mocked(ingestInbound)).not.toHaveBeenCalled();
  });
});

describe('POST /api/channels/sms — HELP keyword', () => {
  const HELP_VARIANTS = ['HELP', 'help', 'Help', 'INFO', 'info'];

  for (const kw of HELP_VARIANTS) {
    it(`"${kw}" → returns TwiML with help reply, does NOT call optOutSms or ingest`, async () => {
      const body = encodeParams({ From: '+15550000003', Body: kw });
      const res = await POST(makeRequest(body));

      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toBe('text/xml');

      const text = await res.text();
      expect(text).toContain(SMS_HELP_REPLY);
      expect(text).toContain('<Response>');

      expect(vi.mocked(optOutSms)).not.toHaveBeenCalled();
      expect(vi.mocked(ingestInbound)).not.toHaveBeenCalled();
    });
  }
});

describe('POST /api/channels/sms — normal inbound messages', () => {
  it('a normal message falls through to ingest, does NOT call optOutSms', async () => {
    const body = encodeParams({ From: '+15550000004', Body: 'approve the thing' });
    const res = await POST(makeRequest(body));

    // Empty TwiML ack
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toBe('<Response></Response>');

    expect(vi.mocked(ingestInbound)).toHaveBeenCalledOnce();
    expect(vi.mocked(optOutSms)).not.toHaveBeenCalled();
  });

  it('"stop the invoice" is NOT a STOP keyword — falls through to ingest', async () => {
    const body = encodeParams({ From: '+15550000005', Body: 'stop the invoice' });
    const res = await POST(makeRequest(body));

    expect(res.status).toBe(200);
    expect(vi.mocked(ingestInbound)).toHaveBeenCalledOnce();
    expect(vi.mocked(optOutSms)).not.toHaveBeenCalled();
  });

  it('"help me with this" is NOT a HELP keyword — falls through to ingest', async () => {
    const body = encodeParams({ From: '+15550000006', Body: 'help me with this' });
    const res = await POST(makeRequest(body));

    expect(res.status).toBe(200);
    expect(vi.mocked(ingestInbound)).toHaveBeenCalledOnce();
    expect(vi.mocked(optOutSms)).not.toHaveBeenCalled();
  });
});

describe('POST /api/channels/sms — START keyword (TCPA re-subscribe)', () => {
  const START_VARIANTS = ['START', 'start', 'Start', 'YES', 'yes', 'UNSTOP', 'unstop'];

  for (const kw of START_VARIANTS) {
    it(`"${kw}" → calls optInSms, returns TwiML with start reply, does NOT ingest`, async () => {
      const body = encodeParams({ From: '+15550000007', Body: kw });
      const res = await POST(makeRequest(body));

      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toBe('text/xml');

      const text = await res.text();
      expect(text).toContain(SMS_START_REPLY);
      expect(text).toContain('<Response>');
      expect(text).toContain('<Message>');

      expect(vi.mocked(optInSms)).toHaveBeenCalledWith('+15550000007');
      expect(vi.mocked(ingestInbound)).not.toHaveBeenCalled();
      expect(vi.mocked(optOutSms)).not.toHaveBeenCalled();
    });
  }

  it('START with leading/trailing spaces is still treated as re-subscribe', async () => {
    const body = encodeParams({ From: '+15550000008', Body: '  START  ' });
    const res = await POST(makeRequest(body));
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain(SMS_START_REPLY);
    expect(vi.mocked(optInSms)).toHaveBeenCalledWith('+15550000008');
    expect(vi.mocked(ingestInbound)).not.toHaveBeenCalled();
    expect(vi.mocked(optOutSms)).not.toHaveBeenCalled();
  });

  it('"start the meeting" is NOT a START keyword — falls through to ingest', async () => {
    const body = encodeParams({ From: '+15550000009', Body: 'start the meeting' });
    const res = await POST(makeRequest(body));

    expect(res.status).toBe(200);
    expect(vi.mocked(ingestInbound)).toHaveBeenCalledOnce();
    expect(vi.mocked(optInSms)).not.toHaveBeenCalled();
  });
});
