import 'server-only';
import { NextResponse, type NextRequest } from 'next/server';
import { timingSafeEqual } from 'node:crypto';
import { serviceClient } from '../../../../lib/supabase/service';
import { GmailClient, SupabaseTokenVault, SupabaseWebhookEventStore, CONNECTOR_REGISTRY } from '@nibbin/connectors';
import { activeNibbinsForAccount, triggerNibbinRun, connectionFromRow } from '../../../../lib/runtime/engine';
import { dispatchForConnection } from '../../../../lib/connections/dispatch';
import { fetchGmailDelta, advanceGmailCursor } from '../../../../lib/connections/gmail-delta';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const WEBHOOK_SUPPORTED_PROVIDERS = [...CONNECTOR_REGISTRY.values()]
  .filter((d) => d.webhooks.supported)
  .map((d) => d.id);

function authorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const header = req.headers.get('authorization') ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  // Always compare same-length buffers to avoid timing leak
  const padded = token.padEnd(secret.length, '\0').slice(0, secret.length);
  const a = Buffer.from(padded);
  const b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b) && token.length === secret.length;
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  if (!authorized(req)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const svc = serviceClient();
  const eventStore = new SupabaseWebhookEventStore(
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? '',
    process.env.SUPABASE_SECRET_KEY ?? '',
  );
  const vault = new SupabaseTokenVault({
    supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL ?? '',
    serviceKey: process.env.SUPABASE_SECRET_KEY ?? '',
  });

  const { data: rows, error } = await svc
    .from('connections')
    .select('*')
    .eq('status', 'active')
    .in('provider', WEBHOOK_SUPPORTED_PROVIDERS);

  if (error) {
    return NextResponse.json({ error: 'query_failed' }, { status: 500 });
  }

  const connections = (rows ?? []).map(connectionFromRow);

  let processed = 0;
  let triggered = 0;
  const errors: string[] = [];

  for (const connection of connections) {
    try {
      if (connection.provider !== 'gmail') continue;

      const client = new GmailClient(connection, vault);

      const { events, newHistoryId } = await fetchGmailDelta(
        connection.id,
        connection.accountId,
        connection.webhookState,
        {
          historyList: async (startHistoryId) => {
            const res = await client.historyList({ startHistoryId });
            const messages = (res.history ?? []).flatMap((h) => h.messages ?? []);
            return { messages, historyId: res.historyId ?? startHistoryId };
          },
          getProfileHistoryId: async () => {
            const profile = await client.getProfile();
            return profile.historyId;
          },
        },
      );

      for (const event of events) {
        const isFirst = await eventStore.recordOnce('gmail', event.dedupeKey, connection.id);
        if (!isFirst) continue;
        const result = await dispatchForConnection(event, {
          activeNibbinsForAccount: (accountId) => activeNibbinsForAccount(svc, accountId),
          triggerRun: (nibbinId, trigger) => triggerNibbinRun(nibbinId, trigger),
        });
        triggered += result.triggered;
        if (result.capped) {
          console.warn(`[connector-poll] fan-out ceiling hit for account ${connection.accountId}`);
        }
      }

      await advanceGmailCursor(svc, connection.id, newHistoryId);
      processed++;
    } catch (e) {
      errors.push(`${connection.id}: ${(e as Error).message}`);
    }
  }

  return NextResponse.json({ processed, triggered, errors });
}
