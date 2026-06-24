import { NextResponse, type NextRequest } from 'next/server';
import { FREE_TIER_MONTHLY_ALLOTMENT, freeRefreshPeriodKey } from '@nibbin/shared';
import { serviceClient } from '../../../../lib/supabase/service';
import { isAuthorizedCronRequest } from '../../../../lib/connections/cron-auth';

/**
 * Monthly free-tier ("Hatchling") credit refresh.
 *
 * Usage metering (#259) charges credits on all model usage; the free tier
 * receives no Stripe-driven monthly grant, so without this it drains to zero
 * and stays there. This route tops every Hatchling account UP TO its monthly
 * allotment (top-up semantics — no stacking; see packages/shared freeRefresh*).
 * Refill rows use the dedicated 'refill' ledger reason (a variable top-up),
 * distinct from the fixed paid 'grant'.
 *
 * Idempotent: the work runs in one set-based, security-definer RPC keyed to the
 * calendar month (freemonthly_YYYY-MM). A unique refill index (account_id,
 * source_id) makes a same-month re-run a no-op — Vercel may invoke a cron more
 * than once, and a manual re-run must never double-refill.
 *
 * Scheduled on the 1st of each month (apps/web/vercel.json). The period key is
 * derived server-side from "now" (UTC), so the refill lands in the month the
 * job actually runs.
 */
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(req: NextRequest): Promise<NextResponse> {
  if (!isAuthorizedCronRequest(req)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const period = freeRefreshPeriodKey();

  try {
    const { data, error } = await serviceClient().rpc('refresh_free_tier_credits', {
      p_period: period,
      p_allotment: FREE_TIER_MONTHLY_ALLOTMENT,
    });
    if (error) {
      console.error('[freetier-credit-refresh] RPC error:', error.message);
      return NextResponse.json({ ok: false, period, error: error.message });
    }
    const granted = (data as number) ?? 0;
    console.log(`[freetier-credit-refresh] period ${period}: granted ${granted} free account(s)`);
    return NextResponse.json({ ok: true, period, granted });
  } catch (err) {
    console.error(
      '[freetier-credit-refresh] unexpected error:',
      err instanceof Error ? err.message : String(err),
    );
    return NextResponse.json({ ok: false, period, error: 'internal' });
  }
}
