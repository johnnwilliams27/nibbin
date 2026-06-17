import 'server-only';
import { NextResponse, type NextRequest } from 'next/server';
import { serviceClient } from '../../../../lib/supabase/service';
import { GmailClient, SupabaseTokenVault } from '@nibbin/connectors';
import { connectionFromRow } from '../../../../lib/runtime/engine';
import { isAuthorizedCronRequest } from '../../../../lib/connections/cron-auth';

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

  const vault = new SupabaseTokenVault({
    supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL ?? '',
    serviceKey: process.env.SUPABASE_SECRET_KEY ?? '',
  });

  let registered = 0;
  const errors: string[] = [];

  for (const row of due) {
    try {
      const connection = connectionFromRow(row as Record<string, unknown>);
      const client = new GmailClient(connection, vault);
      const { historyId, expiration } = await client.watch(topicName);

      const patch: Record<string, string> = {};
      if (historyId) patch.historyId = historyId;
      if (expiration) patch.watchExpiry = new Date(Number(expiration)).toISOString();

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
