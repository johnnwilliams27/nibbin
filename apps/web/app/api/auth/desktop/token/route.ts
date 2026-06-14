/**
 * Desktop auth bridge — STEP 2 (token exchange). The desktop posts the one-time
 * code + its PKCE code_verifier. We look the code up by hash, enforce single-use
 * + TTL, verify S256(verifier) === stored challenge, then hand back the session
 * and delete the code. A party that merely intercepts the nibbin://auth deep link
 * can't redeem it — they don't hold the verifier.
 */
import { NextResponse } from 'next/server';
import { createHash } from 'node:crypto';
import { serviceClient } from '../../../../../lib/supabase/service';

export const dynamic = 'force-dynamic';

function b64urlSha256(input: string): string {
  return createHash('sha256').update(input).digest('base64url');
}

export async function POST(req: Request) {
  let body: { code?: unknown; code_verifier?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'bad request' }, { status: 400 });
  }

  const code = typeof body.code === 'string' ? body.code : '';
  const verifier = typeof body.code_verifier === 'string' ? body.code_verifier : '';
  if (!code || !verifier) {
    return NextResponse.json({ error: 'missing code or verifier' }, { status: 400 });
  }

  const codeHash = createHash('sha256').update(code).digest('hex');
  const svc = serviceClient();

  const { data: row } = await svc
    .from('desktop_auth_codes')
    .select('challenge, session, used, expires_at')
    .eq('code_hash', codeHash)
    .maybeSingle<{ challenge: string; session: unknown; used: boolean; expires_at: string }>();

  if (!row || row.used || new Date(row.expires_at).getTime() < Date.now()) {
    return NextResponse.json({ error: 'invalid or expired code' }, { status: 400 });
  }

  if (b64urlSha256(verifier) !== row.challenge) {
    return NextResponse.json({ error: 'pkce verification failed' }, { status: 400 });
  }

  // Single-use: delete before returning so a replay finds nothing.
  await svc.from('desktop_auth_codes').delete().eq('code_hash', codeHash);

  return NextResponse.json(row.session);
}
