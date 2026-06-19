import { timingSafeEqual } from 'node:crypto';
import type { InboundChannelMessage } from './types';

function safeEq(a: string, b: string): boolean {
  const ab = Buffer.from(a), bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

export function verifyTelegramSecret(expected: string, header: string | null): boolean {
  if (!expected) return false;
  return header != null && safeEq(expected, header);
}

export function telegramStartLink(botUsername: string, nonce: string): string {
  return `https://t.me/${botUsername}?start=${nonce}`;
}

interface TelegramUpdate {
  callback_query?: { message?: { chat?: { id?: unknown } }; data?: unknown };
  message?: { chat?: { id?: unknown }; text?: unknown };
}

const PLAN_ACTIONS = new Set(['ps:go', 'ps:cancel', 'pw:approve', 'pw:reject']);

export function parseTelegramUpdate(update: unknown, now: number): InboundChannelMessage | null {
  const u = update as TelegramUpdate;
  if (u?.callback_query) {
    const chatId = u.callback_query.message?.chat?.id;
    const data = String(u.callback_query.data ?? '');
    if (chatId == null) return null;
    // Plan-session callbacks: exact match (ps:go, ps:cancel, pw:approve, pw:reject).
    if (PLAN_ACTIONS.has(data)) {
      return {
        channel: 'telegram', externalId: String(chatId), text: data, receivedAt: now,
        planAction: data as 'ps:go' | 'ps:cancel' | 'pw:approve' | 'pw:reject',
      };
    }
    // FIX 4: pw:approve:<rid> and pw:reject:<rid> — base action + embedded requestId.
    if (data.startsWith('pw:approve:') || data.startsWith('pw:reject:')) {
      const isApprove = data.startsWith('pw:approve:');
      const base = isApprove ? 'pw:approve' : 'pw:reject';
      const rid = data.slice(base.length + 1); // skip "pw:approve:" or "pw:reject:"
      return {
        channel: 'telegram', externalId: String(chatId), text: data, receivedAt: now,
        planAction: base as 'pw:approve' | 'pw:reject',
        planRequestId: rid || undefined,
      };
    }
    // Legacy: "<requestId>:<action>" format for agent-run approvals.
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
