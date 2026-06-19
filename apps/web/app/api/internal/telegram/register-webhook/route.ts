import { NextResponse, type NextRequest } from 'next/server';
import { timingSafeEqual } from 'node:crypto';
import { setTelegramWebhook, getTelegramWebhookInfo } from '@nibbin/channels';
import { siteOrigin } from '../../../../../lib/site-url';

/**
 * Internal-only: registers (POST) or inspects (GET) the Telegram webhook.
 * Called once at go-live from a trusted server-to-server context, authenticated
 * by INTERNAL_API_SECRET — never exposed to a browser.
 *
 * POST: reads TELEGRAM_BOT_TOKEN + TELEGRAM_WEBHOOK_SECRET, derives the target
 *   URL (TELEGRAM_WEBHOOK_URL if set, else <siteOrigin>/api/channels/telegram),
 *   calls Telegram setWebhook, returns { ok, description }.
 * GET:  calls Telegram getWebhookInfo so the operator can verify the registered
 *   URL without opening the Telegram dashboard.
 */

function authorized(req: NextRequest): boolean {
  const secret = process.env.INTERNAL_API_SECRET;
  if (!secret) return false;
  const header = req.headers.get('authorization') ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  const a = Buffer.from(token);
  const b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  if (!authorized(req)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  if (!botToken) {
    return NextResponse.json({ error: 'TELEGRAM_BOT_TOKEN is not set' }, { status: 500 });
  }
  const webhookSecret = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (!webhookSecret) {
    return NextResponse.json({ error: 'TELEGRAM_WEBHOOK_SECRET is not set' }, { status: 500 });
  }

  const webhookUrl =
    process.env.TELEGRAM_WEBHOOK_URL ?? `${siteOrigin()}/api/channels/telegram`;

  const result = await setTelegramWebhook({
    botToken,
    url: webhookUrl,
    secret: webhookSecret,
  });

  return NextResponse.json(result, { status: result.ok ? 200 : 502 });
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  if (!authorized(req)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  if (!botToken) {
    return NextResponse.json({ error: 'TELEGRAM_BOT_TOKEN is not set' }, { status: 500 });
  }

  const result = await getTelegramWebhookInfo({ botToken });

  return NextResponse.json(result, { status: result.ok ? 200 : 502 });
}
