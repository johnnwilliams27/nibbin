import 'server-only';
import { timingSafeEqual } from 'node:crypto';

/**
 * Constant-time check that a request carries the Vercel Cron bearer secret.
 *
 * Fail-closed when `CRON_SECRET` is unset (an unconfigured deploy authorizes
 * nothing). The token is padded to the secret length before comparison so
 * `timingSafeEqual` never throws on a length mismatch, and an explicit
 * `token.length === secret.length` guard means a shorter/longer token is
 * rejected without leaking the secret length through an early return.
 *
 * Shared by every cron route (connector-poll, gmail-watch-renew,
 * account-purge) so the authorization logic lives in exactly one place.
 */
export function isAuthorizedCronRequest(req: { headers: { get(name: string): string | null } }): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const header = req.headers.get('authorization') ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  const padded = token.padEnd(secret.length, '\0').slice(0, secret.length);
  const a = Buffer.from(padded);
  const b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b) && token.length === secret.length;
}
