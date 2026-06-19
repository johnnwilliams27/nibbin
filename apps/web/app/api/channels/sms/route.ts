import { NextResponse } from 'next/server';
import { parseTwilioInbound, verifyTwilioSignature, isStopKeyword, isHelpKeyword, isStartKeyword, SMS_STOP_REPLY, SMS_HELP_REPLY, SMS_START_REPLY } from '@nibbin/channels';
import { ingestInbound } from '../../../../lib/channels/ingest';
import { supabaseIngestDeps } from '../../../../lib/channels/ingest-deps';
import { optOutSms, optInSms } from '../../../../lib/channels/sms-compliance';

// A channel-initiated message can start/resume a Planner run INLINE (ingestInbound
// → channel.ts → runPlan), which may launch serverless Chromium for a computer_use
// plan (50s loop wall-clock ceiling). 60s is the Vercel HOBBY hard cap, so we pin
// here to deploy/run on ANY plan; the 50s loop ceiling leaves headroom for the
// Chromium cold-start + teardown under this 60s function limit. On a Pro+ plan
// raise this to 120/300 AND bump COMPUTER_USE_CEILINGS.maxWallClockMs together.
// nodejs runtime is required for @sparticuz/chromium (a native binary — not
// edge-compatible).
export const runtime = 'nodejs';
export const maxDuration = 60;

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
  if (isStartKeyword(bodyText)) {
    await optInSms(from);
    return twiml(SMS_START_REPLY);
  }

  // ── Normal inbound — parse and ingest ────────────────────────────────────
  const msg = parseTwilioInbound(new URLSearchParams(raw), Date.now());
  if (msg) await ingestInbound(msg, supabaseIngestDeps());
  return new NextResponse('<Response></Response>', { status: 200, headers: { 'content-type': 'text/xml' } });
}
