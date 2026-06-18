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

  const svc = serviceClient();

  // #112: atomic claim-before-work. The onboarding sweep is a one-time derive per
  // connection that reads ~90 days of inbox and spends model budget. Replacing
  // the old read-then-act guard, claim_gmail_sweep INSERTs a 'running' sentinel
  // guarded by a partial unique index on (connection_id); concurrent dispatches
  // (or replays of the static HMAC) that lose the race get a null id back and are
  // skipped, so the full inbox is read — and budget spent — at most once. A prior
  // 'failed' row is not in the index, so a genuine retry re-claims. The claim row
  // is then UPDATEd to the final status by id (no concurrency on a PK update).
  const { data: claimId, error: claimErr } = await svc.rpc('claim_gmail_sweep', {
    _account_id: accountId,
    _connection_id: connectionId,
  });
  if (claimErr) {
    console.error('[sweep/route] claim failed', claimErr.message);
    return NextResponse.json({ error: 'claim_failed' }, { status: 500 });
  }
  if (!claimId) {
    return NextResponse.json({ status: 'skipped', reason: 'already_swept' });
  }

  try {
    const result = await gmailOnboardingSweep(accountId, connectionId);
    await svc
      .from('gmail_sweep_log')
      .update({
        status: result.status,
        messages_read: result.messagesRead,
        oldest_message_date: result.derived.oldestMessageDate || null,
        swept_at: new Date().toISOString(),
      })
      .eq('id', claimId);
    return NextResponse.json({ status: result.status, messagesRead: result.messagesRead });
  } catch (err) {
    console.error('[sweep/route] sweep failed', err instanceof Error ? err.message : err);
    // Finalize the claim row to 'failed' with a real error_summary. 'failed' is
    // outside the partial unique index, so a later callback retry can re-claim.
    const errorSummary = (err instanceof Error ? err.message : String(err)).slice(0, 500);
    const { error: logErr } = await svc
      .from('gmail_sweep_log')
      .update({ status: 'failed', error_summary: errorSummary })
      .eq('id', claimId);
    if (logErr) console.error('[sweep/route] failed to finalize sweep failure log', logErr.message);
    return NextResponse.json({ error: 'sweep_failed' }, { status: 500 });
  }
}
