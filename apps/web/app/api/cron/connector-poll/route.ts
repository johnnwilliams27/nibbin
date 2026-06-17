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

// P3.5: bound how many connections one 60s invocation processes so coverage is
// fair and a large backlog can't blow the function budget. Ordered by created_at
// for a deterministic, stable batch. FOLLOW-UP: a last_polled_at column would let
// us rotate oldest-polled-first instead of always favouring the earliest-created
// connections; deferred to avoid a migration here.
const CONNECTION_BATCH_LIMIT = 25;

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
    .in('provider', WEBHOOK_SUPPORTED_PROVIDERS)
    .order('created_at', { ascending: true })
    .limit(CONNECTION_BATCH_LIMIT);

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

      // P3.4: every event for a connection resolves the same account, so fetch
      // the active Nibbins ONCE per connection per cycle and reuse the result
      // across all of this connection's events instead of re-joining the DB
      // inside the per-message loop (which was O(messages) identical queries,
      // re-run in full every 5 min while a capped cursor stays parked).
      let nibbinsForAccount: Awaited<ReturnType<typeof activeNibbinsForAccount>> | undefined;
      const resolveNibbins = async (accountId: string) => {
        if (nibbinsForAccount === undefined) {
          nibbinsForAccount = await activeNibbinsForAccount(svc, accountId);
        }
        return nibbinsForAccount;
      };

      let anyCapped = false;
      for (const event of events) {
        const result = await dispatchForConnection(event, {
          activeNibbinsForAccount: (accountId) => resolveNibbins(accountId),
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
