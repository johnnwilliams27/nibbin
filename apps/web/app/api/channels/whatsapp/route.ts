import { NextResponse } from 'next/server';
import { parseWhatsAppWebhook, verifyMetaSignature } from '@nibbin/channels';
import { ingestInbound } from '../../../../lib/channels/ingest';
import { supabaseIngestDeps } from '../../../../lib/channels/ingest-deps';

// Meta verification handshake (GET) — echo hub.challenge when the verify token matches.
export async function GET(req: Request): Promise<Response> {
  const u = new URL(req.url);
  if (u.searchParams.get('hub.verify_token') === (process.env.WHATSAPP_VERIFY_TOKEN ?? '')) {
    return new NextResponse(u.searchParams.get('hub.challenge') ?? '', { status: 200 });
  }
  return NextResponse.json({ ok: false }, { status: 403 });
}

export async function POST(req: Request): Promise<Response> {
  if (process.env.CHANNELS_WHATSAPP_ENABLED !== 'true') return NextResponse.json({ ok: false }, { status: 503 });
  const raw = await req.text();
  if (!verifyMetaSignature(process.env.WHATSAPP_APP_SECRET ?? '', raw, req.headers.get('x-hub-signature-256'))) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }
  const msg = parseWhatsAppWebhook(JSON.parse(raw), Date.now());
  if (msg) await ingestInbound(msg, supabaseIngestDeps());
  return NextResponse.json({ ok: true });
}
