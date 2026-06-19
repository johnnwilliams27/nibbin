import { describe, it, expect } from 'vitest';
import { parseTelegramUpdate, verifyTelegramSecret, telegramStartLink } from '@nibbin/channels';

describe('telegram inbound', () => {
  it('parses a /start <nonce> as a link request', () => {
    const m = parseTelegramUpdate({ message: { chat: { id: 987, username: 'maya' }, text: '/start ab12cd' } }, 1000);
    expect(m).toMatchObject({ channel: 'telegram', externalId: '987', startNonce: 'ab12cd', receivedAt: 1000 });
  });
  it('parses a plain message', () => {
    const m = parseTelegramUpdate({ message: { chat: { id: 987 }, text: 'what is my grove doing?' } }, 1);
    expect(m).toMatchObject({ externalId: '987', text: 'what is my grove doing?' });
    expect(m?.startNonce).toBeUndefined();
  });
  it('parses a callback button press into inReplyTo + action', () => {
    const m = parseTelegramUpdate({ callback_query: { message: { chat: { id: 987 } }, data: 'r1:approve' } }, 1);
    expect(m).toMatchObject({ externalId: '987', inReplyTo: 'r1', action: 'approve' });
  });
  it('returns null for an update with no actionable content', () => {
    expect(parseTelegramUpdate({ edited_message: {} }, 1)).toBeNull();
  });
  it('verifies the secret token (constant-time) and builds the start link', () => {
    expect(verifyTelegramSecret('s3cret', 's3cret')).toBe(true);
    expect(verifyTelegramSecret('s3cret', 'nope')).toBe(false);
    expect(verifyTelegramSecret('s3cret', null)).toBe(false);
    expect(telegramStartLink('NibbinBot', 'ab12cd')).toBe('https://t.me/NibbinBot?start=ab12cd');
  });
  it('fails closed when configured secret is empty — attacker cannot bypass with empty header', () => {
    // An empty configured secret must NEVER pass, even when the attacker sends
    // an empty header (which would compare equal via timingSafeEqual on two
    // empty buffers without the guard).
    expect(verifyTelegramSecret('', '')).toBe(false);
    expect(verifyTelegramSecret('', null)).toBe(false);
  });

  // Task 4: plan-session callback parsing
  describe('plan-session callbacks (Task 4)', () => {
    const planCases: Array<['ps:go' | 'ps:cancel' | 'pw:approve' | 'pw:reject']> = [
      ['ps:go'], ['ps:cancel'], ['pw:approve'], ['pw:reject'],
    ];

    it.each(planCases)('parses %s callback as planAction (no inReplyTo or action)', (data) => {
      const m = parseTelegramUpdate(
        { callback_query: { message: { chat: { id: 42 } }, data } },
        999,
      );
      expect(m).not.toBeNull();
      expect(m?.planAction).toBe(data);
      expect(m?.externalId).toBe('42');
      expect(m?.text).toBe(data);
      expect(m?.receivedAt).toBe(999);
      // Must NOT set legacy fields
      expect(m?.inReplyTo).toBeUndefined();
      expect(m?.action).toBeUndefined();
    });

    // FIX 4: pw:approve:<rid> and pw:reject:<rid> parsing
    it('FIX 4: parses pw:approve:<rid> — sets planAction=pw:approve and planRequestId', () => {
      const m = parseTelegramUpdate(
        { callback_query: { message: { chat: { id: 77 } }, data: 'pw:approve:r42' } },
        100,
      );
      expect(m).not.toBeNull();
      expect(m?.planAction).toBe('pw:approve');
      expect(m?.planRequestId).toBe('r42');
      expect(m?.inReplyTo).toBeUndefined();
      expect(m?.action).toBeUndefined();
    });

    it('FIX 4: parses pw:reject:<rid> — sets planAction=pw:reject and planRequestId', () => {
      const m = parseTelegramUpdate(
        { callback_query: { message: { chat: { id: 77 } }, data: 'pw:reject:abc-123' } },
        100,
      );
      expect(m).not.toBeNull();
      expect(m?.planAction).toBe('pw:reject');
      expect(m?.planRequestId).toBe('abc-123');
      expect(m?.inReplyTo).toBeUndefined();
      expect(m?.action).toBeUndefined();
    });

    it('FIX 4: exact pw:approve (no rid) still works as before — no planRequestId', () => {
      const m = parseTelegramUpdate(
        { callback_query: { message: { chat: { id: 77 } }, data: 'pw:approve' } },
        100,
      );
      expect(m?.planAction).toBe('pw:approve');
      expect(m?.planRequestId).toBeUndefined();
    });

    it('FIX 4: exact pw:reject (no rid) still works as before — no planRequestId', () => {
      const m = parseTelegramUpdate(
        { callback_query: { message: { chat: { id: 77 } }, data: 'pw:reject' } },
        100,
      );
      expect(m?.planAction).toBe('pw:reject');
      expect(m?.planRequestId).toBeUndefined();
    });

    it('still parses a legacy <uuid>:approve callback via the legacy path', () => {
      const m = parseTelegramUpdate(
        { callback_query: { message: { chat: { id: 55 } }, data: 'req-uuid-123:approve' } },
        1,
      );
      expect(m?.inReplyTo).toBe('req-uuid-123');
      expect(m?.action).toBe('approve');
      expect(m?.planAction).toBeUndefined();
    });

    it('still parses a legacy :deny callback via the legacy path', () => {
      const m = parseTelegramUpdate(
        { callback_query: { message: { chat: { id: 55 } }, data: 'req-uuid-456:deny' } },
        1,
      );
      expect(m?.inReplyTo).toBe('req-uuid-456');
      expect(m?.action).toBe('deny');
      expect(m?.planAction).toBeUndefined();
    });
  });
});
