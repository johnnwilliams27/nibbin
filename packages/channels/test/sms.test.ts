import { describe, it, expect } from 'vitest';
import { smsAdapter } from '@nibbin/channels';

function fakeFetch(cap: { url?: string; auth?: string; form?: URLSearchParams }, ok = true): typeof fetch {
  return async (url: string | URL | Request, init?: RequestInit) => {
    cap.url = String(url);
    cap.auth = (init?.headers as Record<string, string>)?.['authorization'];
    cap.form = new URLSearchParams(init?.body as string);
    return { ok, status: ok ? 201 : 400, async json() { return ok ? { sid: 'SM123' } : { message: 'unverified number' }; } } as Response;
  };
}

describe('smsAdapter', () => {
  it('posts form-encoded to Twilio with basic auth and reports per-message COGS', async () => {
    const cap: { url?: string; auth?: string; form?: URLSearchParams } = {};
    const port = smsAdapter({
      accountSid: 'AC1', authToken: 'tok', fromNumber: '+15550000000',
      perMessageMicroUsd: 7900, fetchImpl: fakeFetch(cap),
    });
    const res = await port.deliver({
      accountId: 'acc', channel: 'sms', externalId: '+15551234567',
      kind: 'escalation', urgency: 'high', body: 'Approve the draft?',
      actions: [{ id: 'a', label: 'Approve', kind: 'approve' }, { id: 'd', label: 'Deny', kind: 'deny' }],
      requestId: 'r1',
    });
    expect(res.delivered).toBe(true);
    expect(res.providerMessageId).toBe('SM123');
    expect(res.costMicroUsd).toBe(7900);
    expect(cap.url).toContain('/Accounts/AC1/Messages.json');
    expect(cap.auth).toMatch(/^Basic /);
    expect(cap.form?.get('To')).toBe('+15551234567');
    expect(cap.form?.get('From')).toBe('+15550000000');
    expect(cap.form?.get('Body')).toContain('Reply APPROVE or DENY'); // reply-keyword affordance
  });

  it('returns delivered=false on a provider error', async () => {
    const cap = {};
    const port = smsAdapter({ accountSid: 'AC1', authToken: 'tok', fromNumber: '+1', perMessageMicroUsd: 7900, fetchImpl: fakeFetch(cap, false) });
    const res = await port.deliver({ accountId: 'acc', channel: 'sms', externalId: '+1', kind: 'news', urgency: 'normal', body: 'hi' });
    expect(res.delivered).toBe(false);
    expect(res.error).toContain('unverified');
  });
});
