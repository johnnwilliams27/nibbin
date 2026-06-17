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

  const svc = serviceClient();
  const topicName = process.env.GMAIL_PUBSUB_TOPIC ?? '';
  const renewalHorizon = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

  // Connections whose watch expires within the next 24 hours
  const { data: rows, error } = await svc
    .from('connections')
    .select('*')
    .eq('provider', 'gmail')
    .eq('status', 'active')
    .lt('webhook_state->>watchExpiry', renewalHorizon);

  if (error) return NextResponse.json({ error: 'query_failed' }, { status: 500 });

  const vault = new SupabaseTokenVault({
    supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL ?? '',
    serviceKey: process.env.SUPABASE_SECRET_KEY ?? '',
  });

  let renewed = 0;
  const errors: string[] = [];

  for (const row of rows ?? []) {
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

      renewed++;
    } catch (e) {
      errors.push(`${(row as { id: string }).id}: ${(e as Error).message}`);
    }
  }

  return NextResponse.json({ renewed, errors });
}
