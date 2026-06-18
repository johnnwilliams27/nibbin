import { NextResponse } from 'next/server';
import { parseTwilioInbound, verifyTwilioSignature } from '@nibbin/channels';
import { ingestInbound } from '../../../../lib/channels/ingest';
import { supabaseIngestDeps } from '../../../../lib/channels/ingest-deps';

export async function POST(req: Request): Promise<Response> {
  if (process.env.CHANNELS_SMS_ENABLED !== 'true') return NextResponse.json({ ok: false }, { status: 503 });
  const raw = await req.text();
  const params = Object.fromEntries(new URLSearchParams(raw));
  const url = process.env.SMS_WEBHOOK_URL ?? req.url;
  if (!verifyTwilioSignature(process.env.TWILIO_AUTH_TOKEN ?? '', url, params, req.headers.get('x-twilio-signature'))) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }
  const msg = parseTwilioInbound(new URLSearchParams(raw), Date.now());
  if (msg) await ingestInbound(msg, supabaseIngestDeps());
  // STOP/HELP handling (TCPA) is Plan 06; for now ack with empty TwiML.
  return new NextResponse('<Response></Response>', { status: 200, headers: { 'content-type': 'text/xml' } });
}
