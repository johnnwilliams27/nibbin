import { NextResponse, type NextRequest } from 'next/server';
import { timingSafeEqual } from 'node:crypto';
import { inviteEmail, normalizeEmail, renderTransactional, resendProvider } from '@nibbin/email';
import { serviceClient } from '../../../../lib/supabase/service';
import { siteOrigin } from '../../../../lib/site-url';

/**
 * Internal-only: provision a Founding-Grove invite and send the branded
 * account-creation email. Called server-to-server by the admin app's "Invite"
 * action (admin.nibbin.com), authenticated by a shared INTERNAL_API_SECRET —
 * never exposed to a browser. The actual auth user is minted here with the
 * service role; the link lands on /auth/callback, which bootstraps the account.
 */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function authorized(req: NextRequest): boolean {
  const secret = process.env.INTERNAL_API_SECRET;
  if (!secret) return false;
  const header = req.headers.get('authorization') ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  const a = Buffer.from(token);
  const b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  if (!authorized(req)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  let body: { email?: unknown };
  try {
    body = (await req.json()) as { email?: unknown };
  } catch {
    return NextResponse.json({ error: 'bad_request' }, { status: 400 });
  }
  const email = typeof body.email === 'string' ? normalizeEmail(body.email) : '';
  if (!EMAIL_RE.test(email) || email.length > 254) {
    return NextResponse.json({ error: 'invalid_email' }, { status: 400 });
  }

  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM ?? 'Nibbin <keeper@nibbin.com>';
  const postalAddress = process.env.EMAIL_POSTAL_ADDRESS;
  if (!apiKey) {
    return NextResponse.json({ error: 'email_unconfigured' }, { status: 500 });
  }

  const svc = serviceClient();
  const redirectTo = `${siteOrigin()}/auth/callback`;

  // type:'invite' mints a new auth user. If the address already has an account
  // (re-invite), fall back to a sign-in (magiclink) so the link still works.
  let link: string | null = null;
  const invite = await svc.auth.admin.generateLink({ type: 'invite', email, options: { redirectTo } });
  if (invite.error || !invite.data?.properties?.action_link) {
    const magic = await svc.auth.admin.generateLink({ type: 'magiclink', email, options: { redirectTo } });
    if (magic.error || !magic.data?.properties?.action_link) {
      return NextResponse.json({ error: 'invite_failed' }, { status: 502 });
    }
    link = magic.data.properties.action_link;
  } else {
    link = invite.data.properties.action_link;
  }

  try {
    const msg = renderTransactional(inviteEmail(link), { from, to: email, postalAddress });
    await resendProvider(apiKey).send(msg);
  } catch {
    // The user exists now but the mail didn't go — surface so the admin can retry.
    return NextResponse.json({ error: 'send_failed' }, { status: 502 });
  }

  // Best-effort: stamp the invite so the admin view can show it. Never fatal.
  await svc.from('waitlist').update({ invited_at: new Date().toISOString() }).eq('email', email);

  return NextResponse.json({ ok: true });
}
