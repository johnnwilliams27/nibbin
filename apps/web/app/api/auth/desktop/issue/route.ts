/**
 * Desktop auth bridge — STEP 1 (issue). The /auth/desktop page calls this after
 * an email+password sign-in: we validate the session, mint a one-time code bound
 * to the desktop's PKCE challenge, and store the session server-side keyed by the
 * code's hash. The desktop later redeems the code (STEP 2, /token) by proving the
 * verifier. The session never travels in a URL — only the opaque code does.
 */
import { NextResponse } from 'next/server';
import { createHash, randomBytes } from 'node:crypto';
import { serviceClient } from '../../../../../lib/supabase/service';

export const dynamic = 'force-dynamic';

const TTL_MS = 2 * 60 * 1000; // 2 minutes

export async function POST(req: Request) {
  let body: { challenge?: unknown; session?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'bad request' }, { status: 400 });
  }

  const challenge = typeof body.challenge === 'string' ? body.challenge : '';
  const session = (body.session ?? null) as Record<string, unknown> | null;
  const accessToken = session && typeof session.access_token === 'string' ? session.access_token : '';
  const refreshToken = session && typeof session.refresh_token === 'string' ? session.refresh_token : '';

  if (!challenge || !accessToken || !refreshToken) {
    return NextResponse.json({ error: 'missing challenge or session' }, { status: 400 });
  }

  const svc = serviceClient();

  // Validate the session is real (and identify the user) — never trust the body blindly.
  const { data: userData, error: userErr } = await svc.auth.getUser(accessToken);
  if (userErr || !userData.user) {
    return NextResponse.json({ error: 'invalid session' }, { status: 401 });
  }

  const code = randomBytes(32).toString('base64url');
  const codeHash = createHash('sha256').update(code).digest('hex');
  const expiresAt = new Date(Date.now() + TTL_MS).toISOString();

  const { error: insErr } = await svc.from('desktop_auth_codes').insert({
    code_hash: codeHash,
    challenge,
    session,
    user_id: userData.user.id,
    expires_at: expiresAt,
  });
  if (insErr) {
    return NextResponse.json({ error: 'could not issue code' }, { status: 500 });
  }

  // Opportunistic cleanup of expired codes (TTL is short; no cron needed).
  await svc.from('desktop_auth_codes').delete().lt('expires_at', new Date().toISOString());

  return NextResponse.json({ code });
}
