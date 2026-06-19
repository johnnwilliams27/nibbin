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
});
