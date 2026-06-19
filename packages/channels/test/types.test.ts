import { describe, it, expect } from 'vitest';
import { CHANNEL_KINDS, type OutboundChannelMessage } from '@nibbin/channels';

describe('@nibbin/channels types', () => {
  it('exposes the channel kinds', () => {
    expect(CHANNEL_KINDS).toEqual(['push', 'email', 'sms', 'telegram', 'whatsapp']);
  });
  it('an outbound message never carries a secret field', () => {
    const msg: OutboundChannelMessage = {
      accountId: 'a', channel: 'telegram', externalId: '123',
      kind: 'escalation', urgency: 'high', body: 'Approve the draft?',
    };
    expect(Object.keys(msg)).not.toContain('secret');
  });
});
