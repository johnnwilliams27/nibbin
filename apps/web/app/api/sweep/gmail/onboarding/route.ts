import { NextResponse, type NextRequest } from 'next/server';
import { createHmac } from 'node:crypto';
import { gmailOnboardingSweep } from '../../../../../lib/sweep/gmail-onboarding';

export const dynamic = 'force-dynamic';
export const maxDuration = 60; // Vercel max; sweep uses internal 45 s budget

function verifyHmac(accountId: string, connectionId: string, hmac: string): boolean {
  const secret = process.env.SWEEP_HMAC_SECRET;
  if (!secret) return false;
  const expected = createHmac('sha256', secret)
    .update(`${accountId}:${connectionId}`)
    .digest('hex');
  // constant-time comparison
  return hmac.length === expected.length && hmac === expected;
}

export async function POST(request: NextRequest): Promise<Response> {
  let body: unknown;
  try { body = await request.json(); } catch { return NextResponse.json({ error: 'bad_request' }, { status: 400 }); }

  const { accountId, connectionId, hmac } = (body as Record<string, string>) ?? {};
  if (typeof accountId !== 'string' || typeof connectionId !== 'string' || typeof hmac !== 'string') {
    return NextResponse.json({ error: 'bad_request' }, { status: 400 });
  }
  if (!verifyHmac(accountId, connectionId, hmac)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  try {
    const result = await gmailOnboardingSweep(accountId, connectionId);
    return NextResponse.json({ status: result.status, messagesRead: result.messagesRead });
  } catch (err) {
    console.error('[sweep/route] sweep failed', err instanceof Error ? err.message : err);
    return NextResponse.json({ error: 'sweep_failed' }, { status: 500 });
  }
}
