import { createHmac, timingSafeEqual } from 'node:crypto';
import type { InboundChannelMessage } from './types';

export function parseWhatsAppWebhook(body: unknown, now: number): InboundChannelMessage | null {
  const msg = (body as any)?.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
  if (!msg?.from) return null;
  if (msg.type === 'text' && msg.text?.body) {
    return { channel: 'whatsapp', externalId: String(msg.from), text: msg.text.body, receivedAt: now };
  }
  const reply = msg.interactive?.button_reply;
  if (reply?.id) {
    const [requestId, action] = String(reply.id).split(':');
    return {
      channel: 'whatsapp', externalId: String(msg.from), text: reply.title ?? reply.id, receivedAt: now,
      inReplyTo: requestId || undefined,
      action: action === 'approve' || action === 'deny' ? action : undefined,
    };
  }
  return null;
}

export function verifyMetaSignature(appSecret: string, rawBody: string, header: string | null): boolean {
  if (!appSecret) return false;
  if (!header) return false;
  const expected = 'sha256=' + createHmac('sha256', appSecret).update(rawBody).digest('hex');
  const a = Buffer.from(expected), b = Buffer.from(header);
  return a.length === b.length && timingSafeEqual(a, b);
}
