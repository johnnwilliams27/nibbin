import 'server-only';
import { NextResponse, type NextRequest } from 'next/server';
import { serviceClient } from '../../../../lib/supabase/service';
import { GmailClient, SupabaseTokenVault, SupabaseWebhookEventStore, CONNECTOR_REGISTRY } from '@nibbin/connectors';
import { activeNibbinsForAccount, triggerNibbinRun, connectionFromRow } from '../../../../lib/runtime/engine';
import { dispatchForConnection } from '../../../../lib/connections/dispatch';
import { fetchGmailDelta, advanceGmailCursor } from '../../../../lib/connections/gmail-delta';
import { isAuthorizedCronRequest } from '../../../../lib/connections/cron-auth';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const WEBHOOK_SUPPORTED_PROVIDERS = [...CONNECTOR_REGISTRY.values()]
  .filter((d) => d.webhooks.supported)
  .map((d) => d.id);

export async function GET(req: NextRequest): Promise<NextResponse> {
  if (!isAuthorizedCronRequest(req)) {
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

      let anyCapped = false;
      for (const event of events) {
        const result = await dispatchForConnection(event, {
          activeNibbinsForAccount: (accountId) => activeNibbinsForAccount(svc, accountId),
          triggerRun: (nibbinId, trigger) => triggerNibbinRun(nibbinId, trigger),
          // Per-(message, Nibbin) deduplication: already-dispatched Nibbins are
          // skipped on the re-poll after a capped cycle; excess Nibbins fire.
          recordOnce: (key) => eventStore.recordOnce('gmail', key, connection.id),
        });
        triggered += result.triggered;
        if (result.capped) {
          anyCapped = true;
          console.warn(
            `[connector-poll] fan-out ceiling hit for account ${connection.accountId}: ${result.deferred} Nibbin(s) deferred to next cycle`,
          );
        }
      }

      // FIX 2: only advance the cursor when no event hit the ceiling.
      // Deferred Nibbins re-fire on the next poll; the per-(message, Nibbin)
      // recordOnce inside dispatchForConnection dedupes already-fired ones so
      // only the excess Nibbins trigger. Once a cycle completes uncapped, the
      // cursor advances and the delta moves forward (convergence guaranteed).
      if (!anyCapped) {
        await advanceGmailCursor(svc, connection.id, newHistoryId);
      }
      processed++;
    } catch (e) {
      errors.push(`${connection.id}: ${(e as Error).message}`);
    }
  }

  return NextResponse.json({ processed, triggered, errors });
}
