/**
 * HMAC unsubscribe tokens. The link in every email must keep working without
 * a login, indefinitely (CAN-SPAM honors the request whenever it arrives) —
 * so the token is a signed claim over the address, with no expiry and no DB
 * lookup needed to verify it.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';

const SCOPE = 'drip';

function b64url(buf: Buffer): string {
  return buf.toString('base64url');
}

function sign(payload: string, secret: string): string {
  return b64url(createHmac('sha256', secret).update(payload).digest());
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function unsubscribeToken(email: string, secret: string): string {
  if (!secret) throw new Error('unsubscribe secret is required');
  const payload = b64url(Buffer.from(JSON.stringify({ e: normalizeEmail(email), s: SCOPE })));
  return `${payload}.${sign(payload, secret)}`;
}

/** Returns the verified email address, or null for any malformed/tampered token. */
export function verifyUnsubscribeToken(token: string, secret: string): string | null {
  if (!secret) return null;
  const dot = token.indexOf('.');
  if (dot <= 0) return null;
  const payload = token.slice(0, dot);
  const mac = token.slice(dot + 1);
  let expected: Buffer;
  let given: Buffer;
  try {
    expected = Buffer.from(sign(payload, secret), 'base64url');
    given = Buffer.from(mac, 'base64url');
  } catch {
    return null;
  }
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  try {
    const parsed: unknown = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (typeof parsed !== 'object' || parsed === null) return null;
    const { e, s } = parsed as { e?: unknown; s?: unknown };
    if (s !== SCOPE || typeof e !== 'string' || !e.includes('@')) return null;
    return e;
  } catch {
    return null;
  }
}

export function unsubscribeUrl(email: string, secret: string, siteUrl: string): string {
  const token = unsubscribeToken(email, secret);
  return `${siteUrl.replace(/\/$/, '')}/api/email/unsubscribe?token=${encodeURIComponent(token)}`;
}
