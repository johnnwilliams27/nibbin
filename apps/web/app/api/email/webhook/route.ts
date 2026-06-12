/**
 * Email provider webhook (Resend) — bounces and complaints suppress the
 * address immediately (§6.8: live before the first send). Signature-verified
 * (Svix scheme) with a replay window; the only side effect is an idempotent
 * suppression upsert, so provider redelivery is harmless (GOTCHA #28's
 * seen-vs-processed split collapses safely for pure upserts).
 */
import { NextResponse, type NextRequest } from 'next/server';
import { suppressionFromEvent, verifyWebhook } from '@nibbin/email';
import { serviceClient } from '../../../../lib/supabase/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest): Promise<NextResponse> {
  const secret = process.env.RESEND_WEBHOOK_SECRET;
  if (!secret) return NextResponse.json({ error: 'webhook not configured' }, { status: 503 });

  const payload = await req.text();
  const ok = verifyWebhook(secret, payload, {
    id: req.headers.get('svix-id'),
    timestamp: req.headers.get('svix-timestamp'),
    signature: req.headers.get('svix-signature'),
  });
  if (!ok) return NextResponse.json({ error: 'bad signature' }, { status: 401 });

  let body: unknown;
  try {
    body = JSON.parse(payload);
  } catch {
    return NextResponse.json({ error: 'bad payload' }, { status: 400 });
  }

  const suppression = suppressionFromEvent(body);
  if (suppression) {
    const { error } = await serviceClient()
      .from('email_suppressions')
      .upsert(
        { email: suppression.email, reason: suppression.reason },
        { onConflict: 'email', ignoreDuplicates: true },
      );
    // 500 → provider retries; the upsert is idempotent so retries are safe.
    if (error) return NextResponse.json({ error: 'store failed' }, { status: 500 });
  }

  return NextResponse.json({ received: true });
}
