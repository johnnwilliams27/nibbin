import { NextResponse } from 'next/server';
import { parseTwilioInbound, verifyTwilioSignature, isStopKeyword, isHelpKeyword, SMS_STOP_REPLY, SMS_HELP_REPLY } from '@nibbin/channels';
import { ingestInbound } from '../../../../lib/channels/ingest';
import { supabaseIngestDeps } from '../../../../lib/channels/ingest-deps';
import { optOutSms } from '../../../../lib/channels/sms-compliance';

const twiml = (msg: string) =>
  new NextResponse(`<Response><Message>${msg}</Message></Response>`, {
    status: 200,
    headers: { 'content-type': 'text/xml' },
  });

export async function POST(req: Request): Promise<Response> {
  if (process.env.CHANNELS_SMS_ENABLED !== 'true') return NextResponse.json({ ok: false }, { status: 503 });
  const raw = await req.text();
  const params = Object.fromEntries(new URLSearchParams(raw));
  const url = process.env.SMS_WEBHOOK_URL ?? req.url;
  if (!verifyTwilioSignature(process.env.TWILIO_AUTH_TOKEN ?? '', url, params, req.headers.get('x-twilio-signature'))) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  // ── TCPA compliance: STOP/HELP must be handled BEFORE ingest (Plan 06) ──
  const from = params.From ?? '';
  const bodyText = params.Body ?? '';

  if (isStopKeyword(bodyText)) {
    await optOutSms(from);
    return twiml(SMS_STOP_REPLY);
  }
  if (isHelpKeyword(bodyText)) {
    return twiml(SMS_HELP_REPLY);
  }

  // ── Normal inbound — parse and ingest ────────────────────────────────────
  const msg = parseTwilioInbound(new URLSearchParams(raw), Date.now());
  if (msg) await ingestInbound(msg, supabaseIngestDeps());
  return new NextResponse('<Response></Response>', { status: 200, headers: { 'content-type': 'text/xml' } });
}
