import 'server-only';

/**
 * Pre-flight credit gate (feat/credit-metering-usage).
 *
 * The soft-gate contract (SPEC §6.2): a model call that has ALREADY happened
 * always records its usage charge and its result posts — even into a negative
 * balance. Only STARTING new expensive work checks the balance up front and
 * refuses if the account is broke. This module is that up-front check.
 *
 * `balance > 0` is the bar: an account that has run its credits negative cannot
 * START a new run, but is never blocked from receiving a result already
 * produced. A broke account is refused cleanly (no model call, no spend).
 */
import { serviceClient } from '../supabase/service';

/**
 * The account's current credit balance (sum of all ledger deltas), or null when
 * it cannot be read. Service-role; account-scoped by the account_id filter.
 */
export async function readBalance(accountId: string): Promise<number | null> {
  try {
    const svc = serviceClient();
    const { data, error } = await svc
      .from('credit_ledger')
      .select('delta')
      .eq('account_id', accountId);
    if (error) throw new Error(error.message);
    return (data ?? []).reduce((sum, r) => sum + (r as { delta: number }).delta, 0);
  } catch (err) {
    console.error('[credits] balance read failed', err instanceof Error ? err.message : err);
    return null;
  }
}

/**
 * Whether the account may START new expensive work right now. True only when the
 * balance is strictly positive. Fail-CLOSED: an unreadable ledger refuses the
 * start (never spend on an unprovable balance) — the user is told to retry, the
 * completed-work path is unaffected.
 */
export async function canStartNewWork(accountId: string): Promise<boolean> {
  const bal = await readBalance(accountId);
  return bal !== null && bal > 0;
}

/** Nibbin-voice copy for a broke account that tries to start a new run. */
export const OUT_OF_CREDITS_MESSAGE =
  "You're out of credits, so I can't start anything new right now. Top up and I'll pick this right back up — anything already in flight will still finish.";
