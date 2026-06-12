/**
 * Bounce/complaint webhook verification + event mapping. Resend signs
 * webhooks with the Svix scheme: HMAC-SHA256 over `${id}.${timestamp}.${body}`
 * with the base64 secret (after the `whsec_` prefix), compared against the
 * space-separated `v1,<sig>` list in the svix-signature header.
 *
 * §6.8: these webhooks are live BEFORE the first send — a hard bounce or a
 * complaint suppresses the address immediately and permanently.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';
import type { SuppressionReason } from './types';

const TOLERANCE_MS = 5 * 60 * 1000;

export interface WebhookHeaders {
  id: string | null;
  timestamp: string | null;
  signature: string | null;
}

export function verifyWebhook(
  secret: string,
  payload: string,
  headers: WebhookHeaders,
  now: Date = new Date(),
): boolean {
  if (!secret || !headers.id || !headers.timestamp || !headers.signature) return false;

  const ts = Number(headers.timestamp);
  if (!Number.isFinite(ts)) return false;
  if (Math.abs(now.getTime() - ts * 1000) > TOLERANCE_MS) return false; // replay window

  let key: Buffer;
  try {
    key = Buffer.from(secret.replace(/^whsec_/, ''), 'base64');
  } catch {
    return false;
  }
  const expected = createHmac('sha256', key).update(`${headers.id}.${headers.timestamp}.${payload}`).digest();

  for (const part of headers.signature.split(' ')) {
    const [version, sig] = part.split(',');
    if (version !== 'v1' || !sig) continue;
    let given: Buffer;
    try {
      given = Buffer.from(sig, 'base64');
    } catch {
      continue;
    }
    if (given.length === expected.length && timingSafeEqual(given, expected)) return true;
  }
  return false;
}

export interface SuppressionEvent {
  email: string;
  reason: SuppressionReason;
}

/**
 * Map a verified provider event to a suppression, or null for events we
 * don't act on. Suppression inserts are idempotent, so redelivery of the
 * same event is harmless — "seen" vs "processed" (GOTCHA #28) collapses
 * safely here because the only side effect is an upsert.
 */
export function suppressionFromEvent(body: unknown): SuppressionEvent | null {
  if (typeof body !== 'object' || body === null) return null;
  const { type, data } = body as { type?: unknown; data?: unknown };
  if (typeof type !== 'string' || typeof data !== 'object' || data === null) return null;

  const reason: SuppressionEvent['reason'] | null =
    type === 'email.bounced' ? 'bounce' : type === 'email.complained' ? 'complaint' : null;
  if (!reason) return null;

  const to = (data as { to?: unknown }).to;
  const first = Array.isArray(to) ? to[0] : to;
  if (typeof first !== 'string' || !first.includes('@')) return null;
  return { email: first.trim().toLowerCase(), reason };
}
