import { describe, it, expect, vi, beforeEach } from 'vitest';
import { onGmailConnected } from './dispatch';

function svcStub(conn: Record<string, unknown> | null) {
  const update = vi.fn(() => ({ eq: vi.fn(async () => ({ error: null })) }));
  return {
    from: vi.fn(() => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: conn }) }) }),
      update,
    })),
    __update: update,
  } as never;
}

beforeEach(() => {
  process.env.SWEEP_HMAC_SECRET = 'x';
  vi.restoreAllMocks();
  vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: true } as Response)));
});

describe('onGmailConnected', () => {
  it('does nothing for a non-gmail connection', async () => {
    const r = await onGmailConnected(svcStub({ provider: 'slack', account_id: 'a', sweep_consent_at: null }), 'http://h', 'c', true, 'u');
    expect(r.dispatched).toBe(false);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('stamps consent and dispatches when sweepConsent is true', async () => {
    const svc = svcStub({ provider: 'gmail', account_id: 'a', sweep_consent_at: null });
    const r = await onGmailConnected(svc, 'http://h', 'c', true, 'u');
    expect((svc as { __update: ReturnType<typeof vi.fn> }).__update).toHaveBeenCalledWith(
      expect.objectContaining({ sweep_consent_by: 'u' }),
    );
    expect(r.dispatched).toBe(true);
    expect(fetch).toHaveBeenCalledOnce();
  });

  it('does NOT dispatch when sweepConsent is false and no prior consent', async () => {
    const svc = svcStub({ provider: 'gmail', account_id: 'a', sweep_consent_at: null });
    const r = await onGmailConnected(svc, 'http://h', 'c', false, 'u');
    expect(r.dispatched).toBe(false);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('does not dispatch when SWEEP_HMAC_SECRET is unset', async () => {
    delete process.env.SWEEP_HMAC_SECRET;
    const svc = svcStub({ provider: 'gmail', account_id: 'a', sweep_consent_at: null });
    const r = await onGmailConnected(svc, 'http://h', 'c', true, 'u');
    expect(r.dispatched).toBe(false);
  });

  it('does NOT dispatch on an unrelated flow (sweepConsent false) even if consent pre-exists (LS-1)', async () => {
    // e.g. a write-scope upgrade reusing a previously-consented connection must
    // not re-fire the sweep — only an affirmative opt-in in THIS flow triggers it.
    const svc = svcStub({ provider: 'gmail', account_id: 'a', sweep_consent_at: '2026-06-18T00:00:00Z' });
    const r = await onGmailConnected(svc, 'http://h', 'c', false, 'u');
    expect((svc as { __update: ReturnType<typeof vi.fn> }).__update).not.toHaveBeenCalled();
    expect(r.dispatched).toBe(false);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('dispatches without re-stamping when sweepConsent is true and consent pre-exists', async () => {
    const svc = svcStub({ provider: 'gmail', account_id: 'a', sweep_consent_at: '2026-06-18T00:00:00Z' });
    const r = await onGmailConnected(svc, 'http://h', 'c', true, 'u');
    expect((svc as { __update: ReturnType<typeof vi.fn> }).__update).not.toHaveBeenCalled();
    expect(r.dispatched).toBe(true);
    expect(fetch).toHaveBeenCalledOnce();
  });
});
