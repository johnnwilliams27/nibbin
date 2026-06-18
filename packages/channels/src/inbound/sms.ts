import { createHmac, timingSafeEqual } from 'node:crypto';
import type { InboundChannelMessage } from './types';

export function parseTwilioInbound(form: URLSearchParams, now: number): InboundChannelMessage | null {
  const from = form.get('From');
  const body = form.get('Body');
  if (!from || body == null) return null;
  const upper = body.trim().toUpperCase();
  const action = upper === 'APPROVE' ? 'approve' : upper === 'DENY' ? 'deny' : undefined;
  return { channel: 'sms', externalId: from, text: body, action, receivedAt: now };
}

export function verifyTwilioSignature(
  authToken: string, url: string, params: Record<string, string>, header: string | null,
): boolean {
  if (!authToken) return false;
  if (!header) return false;
  const data = url + Object.keys(params).sort().map((k) => k + params[k]).join('');
  const expected = createHmac('sha1', authToken).update(data).digest('base64');
  const a = Buffer.from(expected), b = Buffer.from(header);
  return a.length === b.length && timingSafeEqual(a, b);
}
