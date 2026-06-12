import 'server-only';

/**
 * HMAC confirm tokens for the waitlist double-opt-in — same shape as the email
 * unsubscribe token (signed claim over the address, no DB lookup, no expiry
 * needed because confirming is idempotent). Reuses EMAIL_UNSUBSCRIBE_SECRET.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';

const SCOPE = 'waitlist';
const MAX_AGE_SECONDS = 30 * 24 * 60 * 60; // confirm links are good for 30 days

function sign(payload: string, secret: string): string {
  return createHmac('sha256', secret).update(payload).digest('base64url');
}

export function waitlistToken(email: string, secret: string, nowSec = Math.floor(Date.now() / 1000)): string {
  if (!secret) throw new Error('waitlist token secret is required');
  const payload = Buffer.from(JSON.stringify({ e: email.trim().toLowerCase(), s: SCOPE, t: nowSec })).toString(
    'base64url',
  );
  return `${payload}.${sign(payload, secret)}`;
}

export function verifyWaitlistToken(token: string, secret: string, nowSec = Math.floor(Date.now() / 1000)): string | null {
  if (!secret) return null;
  const dot = token.indexOf('.');
  if (dot <= 0) return null;
  const payload = token.slice(0, dot);
  try {
    const expected = Buffer.from(sign(payload, secret), 'base64url');
    const given = Buffer.from(token.slice(dot + 1), 'base64url');
    if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
    const claim = JSON.parse(Buffer.from(payload, 'base64url').toString()) as { e?: string; s?: string; t?: number };
    if (claim.s !== SCOPE || typeof claim.e !== 'string') return null;
    // tokens predating the iat field (t absent) are rejected; otherwise expire at 30d
    if (typeof claim.t !== 'number' || nowSec - claim.t > MAX_AGE_SECONDS || claim.t > nowSec + 86400) return null;
    return claim.e;
  } catch {
    return null;
  }
}
