import 'server-only';
import { NextResponse, type NextRequest } from 'next/server';
import { serviceClient } from '../../../../../lib/supabase/service';
import { GmailClient, SupabaseTokenVault, SupabaseWebhookEventStore } from '@nibbin/connectors';
import { connectionFromRow, activeNibbinsForAccount, triggerNibbinRun } from '../../../../../lib/runtime/engine';
import { dispatchForConnection } from '../../../../../lib/connections/dispatch';
import { fetchGmailDelta, advanceGmailCursor } from '../../../../../lib/connections/gmail-delta';
import { verifyPubSubRequest } from '../../../../../lib/connections/push-verify';

export const dynamic = 'force-dynamic';
const DISPATCH_TIMEOUT_MS = 15_000;

export async function POST(req: NextRequest): Promise<NextResponse> {
  const authHeader = req.headers.get('authorization') ?? '';
  const verification = await verifyPubSubRequest(authHeader);
  if (!verification.valid) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const rawBody = await req.arrayBuffer();
  let payload: { message?: { data?: string; messageId?: string } };
  try {
    payload = JSON.parse(Buffer.from(rawBody).toString('utf8')) as typeof payload;
  } catch {
    return NextResponse.json({ error: 'bad_body' }, { status: 400 });
  }

  const messageData = payload.message?.data;
  if (!messageData) return NextResponse.json({ ok: true }); // malformed but ack

  let decoded: { emailAddress?: string; historyId?: string };
  try {
    decoded = JSON.parse(Buffer.from(messageData, 'base64').toString('utf8')) as typeof decoded;
  } catch {
    return NextResponse.json({ ok: true }); // ack, don't retry
  }

  const { emailAddress, historyId } = decoded;
  if (!emailAddress || !historyId) return NextResponse.json({ ok: true });

  const svc = serviceClient();

  // Look up connection by webhook_state.email (Decision B from the design)
  const { data: rows } = await svc
    .from('connections')
    .select('*')
    .eq('provider', 'gmail')
    .eq('status', 'active')
    .contains('webhook_state', { email: emailAddress });

  const connection = rows?.[0] ? connectionFromRow(rows[0] as Record<string, unknown>) : null;
  if (!connection) {
    // No connection found — ack to prevent Pub/Sub retry storm
    // (Flag 3: no-op until Spec 1 seeds webhook_state.email)
    return NextResponse.json({ ok: true });
  }

  // Decision E: ack after recordOnce, before dispatch
  const eventStore = new SupabaseWebhookEventStore(
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? '',
    process.env.SUPABASE_SECRET_KEY ?? '',
  );
  const dedupeKey = `gmail:pubsub:${connection.id}:${historyId}`;
  const isFirst = await eventStore.recordOnce('gmail', dedupeKey, connection.id);
  if (!isFirst) return NextResponse.json({ ok: true }); // replay absorbed

  // Dispatch with timeout — cron safety net catches timeouts
  const ctrl = new AbortController();
  const timeout = setTimeout(() => { ctrl.abort(); }, DISPATCH_TIMEOUT_MS);
  try {
    const vault = new SupabaseTokenVault({
      supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL ?? '',
      serviceKey: process.env.SUPABASE_SECRET_KEY ?? '',
    });
    const client = new GmailClient(connection, vault);
    const { events, newHistoryId } = await fetchGmailDelta(
      connection.id,
      connection.accountId,
      connection.webhookState,
      {
        historyList: async (startHistoryId, signal) => {
          const res = await client.historyList({ startHistoryId }, signal);
          const messages = (res.history ?? []).flatMap((h) => h.messages ?? []);
          return { messages, historyId: res.historyId ?? startHistoryId };
        },
        getProfileHistoryId: async () => {
          const p = await client.getProfile();
          return p.historyId;
        },
      },
      ctrl.signal,
    );

    let anyCapped = false;
    for (const event of events) {
      const result = await dispatchForConnection(event, {
        activeNibbinsForAccount: (accountId) => activeNibbinsForAccount(svc, accountId),
        triggerRun: (nibbinId, trigger) => triggerNibbinRun(nibbinId, trigger),
        // Per-(message, Nibbin) deduplication so already-dispatched Nibbins are
        // skipped on the re-poll after a capped cycle; excess Nibbins fire.
        recordOnce: (key) => eventStore.recordOnce('gmail', key, connection.id),
      });
      if (result.capped) {
        anyCapped = true;
        console.warn(
          `[gmail-push] fan-out ceiling hit for account ${connection.accountId}: ${result.deferred} Nibbin(s) deferred to next cycle`,
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
  } catch (e) {
    if ((e as Error).name !== 'AbortError') {
      console.error('[gmail-push] dispatch error:', (e as Error).message);
    } else {
      console.warn('[gmail-push] dispatch_timeout for connection', connection.id);
    }
    // Return 200 regardless — cron safety net reconciles
  } finally {
    clearTimeout(timeout);
  }

  return NextResponse.json({ ok: true });
}
