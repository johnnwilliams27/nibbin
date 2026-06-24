import { NextResponse, type NextRequest } from 'next/server';
import { serviceClient } from '../../../../lib/supabase/service';
import { isAuthorizedCronRequest } from '../../../../lib/connections/cron-auth';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// OPS: Register this route in apps/web/vercel.json under "crons" with a schedule
// matching plan-run-reaper (every 15 min):
//   { "path": "/api/cron/source-extraction-reaper", "schedule": "*/15 * * * *" }
// The route requires the CRON_SECRET environment variable (same secret used by
// all other cron routes).

export async function GET(req: NextRequest): Promise<NextResponse> {
  if (!isAuthorizedCronRequest(req)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  try {
    const { data, error } = await serviceClient().rpc('reap_stale_extractions', {});
    if (error) {
      console.error('[source-extraction-reaper] RPC error:', error.message);
      return NextResponse.json({ ok: false, error: error.message });
    }
    const reaped = (data as number) ?? 0;
    if (reaped > 0) {
      console.log(`[source-extraction-reaper] reaped ${reaped} stale extraction job(s)`);
    }
    return NextResponse.json({ ok: true, reaped });
  } catch (err) {
    console.error('[source-extraction-reaper] unexpected error:', err instanceof Error ? err.message : err);
    return NextResponse.json({ ok: false, error: 'internal' });
  }
}
