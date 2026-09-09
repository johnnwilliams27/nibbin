import assert from 'node:assert/strict';
import test from 'node:test';
import { avatarInitials, avatarPresentation, safeAvatarUrl } from '../src/lib/avatar.ts';

test('avatars accept public HTTPS image URLs', () => {
  assert.equal(safeAvatarUrl('https://images.example.com/agent.png?size=128'), 'https://images.example.com/agent.png?size=128');
});

test('avatars reject missing, malformed, credentialed and non-HTTPS URLs', () => {
  for (const value of [null, '', '/avatar.png', 'javascript:alert(1)', 'data:image/svg+xml,test', 'http://example.com/a.png', 'https://user:pass@example.com/a.png']) {
    assert.equal(safeAvatarUrl(value), null, String(value));
  }
});

test('avatars do not directly request localhost or private IP literals', () => {
  for (const host of ['localhost', 'localhost.', 'agent.localhost', 'agent.local', '127.0.0.1', '127.1', '0x7f000001', '10.0.0.1', '192.168.1.1', '172.16.0.1', '169.254.169.254', '[::1]', '[::ffff:127.0.0.1]']) {
    assert.equal(safeAvatarUrl(`https://${host}/a.png`), null, host);
  }
});

test('fallback initials are short and preserve Unicode letters', () => {
  assert.equal(avatarInitials('  Yield Agent  '), 'YA');
  assert.equal(avatarInitials('Singularry'), 'SI');
  assert.equal(avatarInitials('Éclair Agent'), 'ÉA');
  assert.equal(avatarInitials(''), '—');
});

test('missing or failed images fall back without retrying the broken URL', () => {
  const url = 'https://images.example.com/agent.png';
  assert.deepEqual(avatarPresentation(url, 'Yield Agent', null), { src: url, initials: 'YA' });
  assert.deepEqual(avatarPresentation(url, 'Yield Agent', url), { src: null, initials: 'YA' });
  assert.deepEqual(avatarPresentation(null, 'Yield Agent', null), { src: null, initials: 'YA' });
  assert.equal(avatarPresentation('https://images.example.com/new.png', 'Yield Agent', url).src, 'https://images.example.com/new.png');
});
