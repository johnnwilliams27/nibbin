import 'server-only';
import { NextResponse, type NextRequest } from 'next/server';
import { serviceClient } from '../../../../lib/supabase/service';
import { GmailClient } from '@nibbin/connectors';
import { connectionFromRow } from '../../../../lib/runtime/engine';
import { isAuthorizedCronRequest } from '../../../../lib/connections/cron-auth';
import { getNango } from '../../../../lib/connectors/nango';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(req: NextRequest): Promise<NextResponse> {
  if (!isAuthorizedCronRequest(req)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const topicName = process.env.GMAIL_PUBSUB_TOPIC ?? '';
  // No Pub/Sub topic configured → push isn't wired; nothing to register. Stay
  // inert rather than calling watch('') and erroring per connection.
  if (!topicName) return NextResponse.json({ skipped: 'no_topic', registered: 0 });

  const svc = serviceClient();
  const renewalHorizon = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

  // Every active Gmail connection — we register a watch for any that either has
  // NO watch yet (null watchExpiry → bootstrap the first watch) or whose watch
  // expires within the next 24h (renew). The prior renew-only query filtered on
  // `watchExpiry < horizon`, which silently excludes null watchExpiry, so a
  // freshly connected inbox never got a first watch and push never started.
  const { data: rows, error } = await svc
    .from('connections')
    .select('*')
    .eq('provider', 'gmail')
    .eq('status', 'active');

  if (error) return NextResponse.json({ error: 'query_failed' }, { status: 500 });

  const due = (rows ?? []).filter((row) => {
    const ws = (row as { webhook_state?: Record<string, unknown> | null }).webhook_state;
    const expiry = ws && typeof ws.watchExpiry === 'string' ? ws.watchExpiry : null;
    return expiry === null || expiry < renewalHorizon;
  });

  const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
  let registered = 0;
  const errors: string[] = [];

  for (const row of due) {
    try {
      const connection = connectionFromRow(row as Record<string, unknown>);
      const ws = (row as { webhook_state?: Record<string, unknown> | null }).webhook_state;
      const existingCursor = ws && typeof ws.historyId === 'string' ? ws.historyId : null;
      // TODO Task 6: replace with makeGmailClient factory
      const client = new GmailClient(connection, getNango(), connection.nangoConnectionId ?? '');
      // Seed the mailbox address: a Pub/Sub push notification carries only the
      // emailAddress, and the push webhook maps it back to this connection via
      // webhook_state.email. Without this the push handler never matches a
      // connection and push delivery is silently inert.
      const profile = await client.getProfile();
      const { historyId, expiration } = await client.watch(topicName);

      const patch: Record<string, string> = {};
      if (profile.emailAddress) patch.email = profile.emailAddress;
      // Only seed historyId when BOOTSTRAPPING the first watch (no cursor yet).
      // On renew the connection already holds a delta cursor at the last-processed
      // message; watch() returns the mailbox's CURRENT historyId, so overwriting
      // would skip every message in the gap (silent loss). The delta cursor is
      // advanced only by the push/poll dispatch path, never here.
      if (historyId && !existingCursor) patch.historyId = historyId;
      // Gmail watches last ~7 days. If the API omits expiration, set a 7-day
      // floor so a watch that returned no expiration is not re-registered on
      // every single cron run.
      patch.watchExpiry = expiration
        ? new Date(Number(expiration)).toISOString()
        : new Date(Date.now() + SEVEN_DAYS_MS).toISOString();

      await svc.rpc('jsonb_merge_connection_state', {
        p_connection: connection.id,
        p_patch: patch,
      });

      registered++;
    } catch (e) {
      errors.push(`${(row as { id: string }).id}: ${(e as Error).message}`);
    }
  }

  return NextResponse.json({ registered, errors });
}
