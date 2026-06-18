import { timingSafeEqual } from 'node:crypto';
import type { InboundChannelMessage } from './types';

function safeEq(a: string, b: string): boolean {
  const ab = Buffer.from(a), bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

export function verifyTelegramSecret(expected: string, header: string | null): boolean {
  return header != null && safeEq(expected, header);
}

export function telegramStartLink(botUsername: string, nonce: string): string {
  return `https://t.me/${botUsername}?start=${nonce}`;
}

export function parseTelegramUpdate(update: unknown, now: number): InboundChannelMessage | null {
  const u = update as any;
  if (u?.callback_query) {
    const chatId = u.callback_query.message?.chat?.id;
    const data = String(u.callback_query.data ?? '');
    if (chatId == null) return null;
    const [requestId, action] = data.split(':');
    return {
      channel: 'telegram', externalId: String(chatId), text: data, receivedAt: now,
      inReplyTo: requestId || undefined,
      action: action === 'approve' || action === 'deny' ? action : undefined,
    };
  }
  const msg = u?.message;
  if (msg?.chat?.id == null || typeof msg.text !== 'string') return null;
  const startMatch = /^\/start\s+(\S+)/.exec(msg.text);
  return {
    channel: 'telegram',
    externalId: String(msg.chat.id),
    text: msg.text,
    startNonce: startMatch ? startMatch[1] : undefined,
    receivedAt: now,
  };
}
