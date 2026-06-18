import { NextResponse } from 'next/server';
import { parseTelegramUpdate, verifyTelegramSecret } from '@nibbin/channels';
import { ingestInbound } from '../../../../lib/channels/ingest';
import { supabaseIngestDeps } from '../../../../lib/channels/ingest-deps';

export async function POST(req: Request): Promise<Response> {
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET ?? '';
  if (!verifyTelegramSecret(secret, req.headers.get('x-telegram-bot-api-secret-token'))) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }
  const update = await req.json().catch(() => null);
  const msg = parseTelegramUpdate(update, Date.now());
  if (!msg) return NextResponse.json({ ok: true }); // nothing actionable; ack so Telegram stops retrying
  await ingestInbound(msg, supabaseIngestDeps());
  return NextResponse.json({ ok: true });
}
