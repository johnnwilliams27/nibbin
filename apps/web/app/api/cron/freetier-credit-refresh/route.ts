import { NextResponse, type NextRequest } from 'next/server';
import {
  FREE_TIER_MONTHLY_ALLOTMENT,
  freeRefreshPeriodKey,
  freeTierRefreshEnabled,
  resolveFleetBudgetCredits,
} from '@nibbin/shared';
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
 *
 * GUARDRAILS (fleet-level spend kill-switch — owner decision, PR #262):
 *   - FREETIER_REFRESH_ENABLED: hard disable flag. Unset/truthy = ON (default).
 *     Set falsy ('false'/'0'/'no'/'off') to turn the whole giveaway off INSTANTLY
 *     without a deploy-revert — the route returns ok:true, disabled:true, no RPC.
 *   - FREETIER_MONTHLY_BUDGET_CREDITS: aggregate ceiling on TOTAL free refill
 *     credits granted per calendar month across ALL accounts (default 50,000 =
 *     $500/mo). The RPC grants oldest-account-first until the period budget is
 *     exhausted, then stops (remaining accounts skipped — fail-safe, no error) and
 *     emits a `freetier_budget_capped` telemetry/alert event.
 */
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

interface RefreshResult {
  refilled: number;
  granted_credits: number;
  capped: boolean;
  budget: number;
  period: string;
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  if (!isAuthorizedCronRequest(req)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const period = freeRefreshPeriodKey();

  // Hard disable flag — instant off-switch, no deploy needed.
  if (!freeTierRefreshEnabled(process.env.FREETIER_REFRESH_ENABLED)) {
    console.log(`[freetier-credit-refresh] period ${period}: DISABLED via FREETIER_REFRESH_ENABLED`);
    return NextResponse.json({ ok: true, period, disabled: true, granted: 0 });
  }

  const budget = resolveFleetBudgetCredits(process.env.FREETIER_MONTHLY_BUDGET_CREDITS);

  try {
    const { data, error } = await serviceClient().rpc('refresh_free_tier_credits', {
      p_period: period,
      p_allotment: FREE_TIER_MONTHLY_ALLOTMENT,
      p_budget: budget,
    });
    if (error) {
      console.error('[freetier-credit-refresh] RPC error:', error.message);
      return NextResponse.json({ ok: false, period, error: error.message });
    }
    const result = (data as RefreshResult | null) ?? {
      refilled: 0,
      granted_credits: 0,
      capped: false,
      budget,
      period,
    };
    if (result.capped) {
      console.warn(
        `[freetier-credit-refresh] period ${period}: FLEET BUDGET CAPPED at ${budget} credits ` +
          `(refilled ${result.refilled} account(s), granted ${result.granted_credits} credits this run)`,
      );
    } else {
      console.log(
        `[freetier-credit-refresh] period ${period}: refilled ${result.refilled} free account(s), ` +
          `granted ${result.granted_credits}/${budget} credits`,
      );
    }
    return NextResponse.json({
      ok: true,
      period,
      granted: result.refilled,
      grantedCredits: result.granted_credits,
      capped: result.capped,
      budget,
    });
  } catch (err) {
    console.error(
      '[freetier-credit-refresh] unexpected error:',
      err instanceof Error ? err.message : String(err),
    );
    return NextResponse.json({ ok: false, period, error: 'internal' });
  }
}
