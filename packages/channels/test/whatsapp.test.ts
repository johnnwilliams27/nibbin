import { describe, it, expect } from 'vitest';
import { whatsappAdapter } from '@nibbin/channels';

function fakeFetch(cap: { url?: string; auth?: string; body?: any }, ok = true) {
  return (async (url: string, init?: any) => {
    cap.url = url; cap.auth = init.headers.authorization; cap.body = JSON.parse(init.body);
    return { ok, status: ok ? 200 : 400, async json() { return ok ? { messages: [{ id: 'wamid.1' }] } : { error: { message: 'template not approved' } }; } } as any;
  }) as unknown as typeof fetch;
}

describe('whatsappAdapter', () => {
  it('sends an interactive button message via the Graph API', async () => {
    const cap: { url?: string; auth?: string; body?: any } = {};
    const port = whatsappAdapter({ phoneNumberId: 'PN1', accessToken: 'tok', perMessageMicroUsd: 5000, fetchImpl: fakeFetch(cap) });
    const res = await port.deliver({
      accountId: 'acc', channel: 'whatsapp', externalId: '15551234567',
      kind: 'escalation', urgency: 'high', body: 'Approve the draft?',
      actions: [{ id: 'a', label: 'Approve', kind: 'approve' }, { id: 'd', label: 'Deny', kind: 'deny' }],
      requestId: 'r1',
    });
    expect(res.delivered).toBe(true);
    expect(res.providerMessageId).toBe('wamid.1');
    expect(res.costMicroUsd).toBe(5000);
    expect(cap.url).toContain('/PN1/messages');
    expect(cap.auth).toBe('Bearer tok');
    expect(cap.body.to).toBe('15551234567');
    expect(cap.body.interactive.action.buttons[0].reply.id).toBe('r1:approve');
  });

  it('returns delivered=false on a provider error', async () => {
    const cap = {};
    const port = whatsappAdapter({ phoneNumberId: 'PN1', accessToken: 'tok', perMessageMicroUsd: 5000, fetchImpl: fakeFetch(cap, false) });
    const res = await port.deliver({ accountId: 'acc', channel: 'whatsapp', externalId: '1', kind: 'news', urgency: 'normal', body: 'hi' });
    expect(res.delivered).toBe(false);
    expect(res.error).toContain('template not approved');
  });
});
