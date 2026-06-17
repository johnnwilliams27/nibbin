import { NextResponse, type NextRequest } from 'next/server';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { gmailOnboardingSweep } from '../../../../../lib/sweep/gmail-onboarding';
import { serviceClient } from '../../../../../lib/supabase/service';

export const dynamic = 'force-dynamic';
export const maxDuration = 60; // Vercel max; sweep uses internal 45 s budget

function verifyHmac(accountId: string, connectionId: string, hmac: string): boolean {
  const secret = process.env.SWEEP_HMAC_SECRET;
  if (!secret) return false;
  const expected = createHmac('sha256', secret)
    .update(`${accountId}:${connectionId}`)
    .digest('hex');
  // constant-time comparison (timingSafeEqual requires equal-length buffers)
  if (hmac.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(hmac), Buffer.from(expected));
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
    // Record the failure so gmail_sweep_log carries a 'failed' row with a real
    // error_summary — without this, failures never reach the table (the success
    // path is the only writer) and the status/error_summary columns stay dead.
    const errorSummary = (err instanceof Error ? err.message : String(err)).slice(0, 500);
    const { error: logErr } = await serviceClient().from('gmail_sweep_log').insert({
      account_id: accountId,
      connection_id: connectionId,
      status: 'failed',
      messages_read: 0,
      error_summary: errorSummary,
    });
    if (logErr) console.error('[sweep/route] failed to write sweep failure log', logErr.message);
    return NextResponse.json({ error: 'sweep_failed' }, { status: 500 });
  }
}
