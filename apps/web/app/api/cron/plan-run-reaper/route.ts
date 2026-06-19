import { NextResponse, type NextRequest } from 'next/server';
import { serviceClient } from '../../../../lib/supabase/service';
import { isAuthorizedCronRequest } from '../../../../lib/connections/cron-auth';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(req: NextRequest): Promise<NextResponse> {
  if (!isAuthorizedCronRequest(req)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  try {
    const { data, error } = await serviceClient().rpc('reap_stale_plan_runs', {});
    if (error) {
      console.error('[plan-run-reaper] RPC error:', error.message);
      return NextResponse.json({ ok: false, error: error.message });
    }
    const reaped = (data as number) ?? 0;
    if (reaped > 0) {
      console.log(`[plan-run-reaper] reaped ${reaped} stale plan run(s)`);
    }
    return NextResponse.json({ ok: true, reaped });
  } catch (err) {
    console.error('[plan-run-reaper] unexpected error:', err instanceof Error ? err.message : err);
    return NextResponse.json({ ok: false, error: 'internal' });
  }
}
