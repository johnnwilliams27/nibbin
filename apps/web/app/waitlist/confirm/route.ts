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
  const site = (process.env.NEXT_PUBLIC_SITE_URL ?? url.origin).replace(/\/$/, '');

  if (!email) {
    return NextResponse.redirect(`${site}/waitlist/confirmed?ok=0`);
  }
  try {
    await serviceClient()
      .from('waitlist')
      .update({ status: 'confirmed', confirmed_at: new Date().toISOString() })
      .eq('email', email);
  } catch {
    return NextResponse.redirect(`${site}/waitlist/confirmed?ok=0`);
  }
  return NextResponse.redirect(`${site}/waitlist/confirmed?ok=1`);
}
