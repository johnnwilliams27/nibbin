import { describe, it, expect } from 'vitest';
import { parseTwilioInbound, verifyTwilioSignature } from '@nibbin/channels';
import { createHmac } from 'node:crypto';

describe('twilio inbound', () => {
  it('parses From + Body and maps APPROVE/DENY keywords to actions', () => {
    const m = parseTwilioInbound(new URLSearchParams({ From: '+15551234567', Body: 'APPROVE' }), 5);
    expect(m).toMatchObject({ channel: 'sms', externalId: '+15551234567', action: 'approve', receivedAt: 5 });
    const n = parseTwilioInbound(new URLSearchParams({ From: '+1', Body: 'chase the overdue ones' }), 5);
    expect(n?.action).toBeUndefined();
    expect(n?.text).toBe('chase the overdue ones');
  });
  it('verifies the X-Twilio-Signature (HMAC-SHA1 over url + sorted params)', () => {
    const url = 'https://nibbin.com/api/channels/sms';
    const params = { From: '+1', Body: 'hi' };
    const data = url + 'Body' + 'hi' + 'From' + '+1';
    const sig = createHmac('sha1', 'tok').update(data).digest('base64');
    expect(verifyTwilioSignature('tok', url, params, sig)).toBe(true);
    expect(verifyTwilioSignature('tok', url, params, 'bad')).toBe(false);
  });
});
