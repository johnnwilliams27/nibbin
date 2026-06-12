import 'server-only';
import { NextResponse } from 'next/server';
import { serviceClient } from '../../../lib/supabase/service';
import { verifyWaitlistToken } from '../../../lib/waitlist/token';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Double-opt-in confirm. GET so the link works from any mail client; the HMAC
 * token is the authority (no session). Idempotent: confirming twice is fine.
 * Always redirects to a friendly status page — no token detail leaks.
 */
export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const token = url.searchParams.get('token') ?? '';
  const secret = process.env.EMAIL_UNSUBSCRIBE_SECRET ?? '';
  const email = verifyWaitlistToken(token, secret);
  // Redirect to a RELATIVE path (resolved against the request) — never an
  // env/Host-derived absolute origin, so a misconfigured proxy can't turn
  // this into an open redirect.
  const dest = (ok: 0 | 1) => NextResponse.redirect(new URL(`/waitlist/confirmed?ok=${ok}`, req.url));

  if (!email) return dest(0);
  try {
    // pending-only: never re-stamp confirmed_at on an already-confirmed row.
    await serviceClient()
      .from('waitlist')
      .update({ status: 'confirmed', confirmed_at: new Date().toISOString() })
      .eq('email', email)
      .eq('status', 'pending');
  } catch {
    return dest(0);
  }
  return dest(1);
}
