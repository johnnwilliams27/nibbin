import { describe, it, expect } from 'vitest';
import { parseWhatsAppWebhook, verifyMetaSignature } from '@nibbin/channels';
import { createHmac } from 'node:crypto';

describe('whatsapp inbound', () => {
  it('parses a text message and a button reply', () => {
    const text = parseWhatsAppWebhook({ entry: [{ changes: [{ value: { messages: [{ from: '15551', type: 'text', text: { body: 'hello' } }] } }] }] }, 9);
    expect(text).toMatchObject({ channel: 'whatsapp', externalId: '15551', text: 'hello' });
    const btn = parseWhatsAppWebhook({ entry: [{ changes: [{ value: { messages: [{ from: '15551', type: 'interactive', interactive: { button_reply: { id: 'r1:deny', title: 'Deny' } } }] } }] }] }, 9);
    expect(btn).toMatchObject({ inReplyTo: 'r1', action: 'deny' });
  });
  it('verifies the X-Hub-Signature-256', () => {
    const raw = '{"a":1}';
    const sig = 'sha256=' + createHmac('sha256', 'appsecret').update(raw).digest('hex');
    expect(verifyMetaSignature('appsecret', raw, sig)).toBe(true);
    expect(verifyMetaSignature('appsecret', raw, 'sha256=bad')).toBe(false);
  });
});
