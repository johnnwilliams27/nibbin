import 'server-only';

/**
 * Free-first-diagnosis entitlement + credit gate (the funnel hook's
 * anti-abuse seam).
 *
 * Product: an account's FIRST field-study diagnosis is free — no plan, no
 * credits. Every diagnosis after that requires credits; that gate is the
 * anti-abuse mechanism that stops the free hook being farmed into runaway LLM
 * spend.
 *
 * This module decides, for one diagnosis attempt, which of three things holds:
 *   - 'free'         — the account's free entitlement was just consumed
 *                      (atomic), so this run is free; skip the credit charge.
 *   - 'charge'       — entitlement already spent, but the account has enough
 *                      credits; proceed and charge after the call.
 *   - 'needs_credits'— entitlement spent and balance too low; refuse WITHOUT
 *                      calling the model (don't spend).
 *
 * Fail-closed: any error reading/consuming the flag or the ledger is treated
 * as "not free" and routed through the credit gate. A flag-read failure must
 * NEVER silently grant infinite free runs.
 */
import { balance, canRun, chargeForRun, type LedgerEntry, WEIGHTS } from '@nibbin/shared';
import { serviceClient } from '../supabase/service';

/** Diagnosis rides the frontier weight (Opus T2 splurge). */
export const DIAGNOSIS_WEIGHT = 'frontier' as const;

export type DiagnosisEntitlement =
  | { kind: 'free' }
  | { kind: 'charge' }
  | { kind: 'needs_credits'; message: string };

/** Nibbin-voice copy for an account that has used its free study and is out of credits. */
export const NEEDS_CREDITS_MESSAGE =
  'You have already had your first study read for free. To run another diagnosis I will need a few credits — top up and I will pick this right back up.';

/**
 * Atomically consume the free-first entitlement, or fall through to the credit
 * gate. Uses the service client (bypasses RLS; this is a trusted server seam).
 *
 * The atomic consume is a WHERE-guarded update:
 *   update accounts set first_diagnosis_consumed = true
 *    where id = ? and first_diagnosis_consumed = false
 * Postgres serializes the row write, so under two concurrent firsts exactly
 * one update returns a row — that one is free, the other falls through.
 */
export async function resolveDiagnosisEntitlement(accountId: string): Promise<DiagnosisEntitlement> {
  const svc = serviceClient();

  // 1) Try to consume the free entitlement atomically. A returned row means
  //    THIS call flipped it false→true and owns the free run.
  try {
    const { data, error } = await svc
      .from('accounts')
      .update({ first_diagnosis_consumed: true })
      .eq('id', accountId)
      .eq('first_diagnosis_consumed', false)
      .select('id');
    if (error) throw new Error(error.message);
    if (data && data.length > 0) {
      return { kind: 'free' };
    }
    // data empty: already consumed (or account missing) — fall through to gate.
  } catch (err) {
    // Fail-closed: a consume error must not grant free runs. Apply the gate.
    console.error(
      '[diagnosis-entitlement] free-first consume failed — applying credit gate',
      err instanceof Error ? err.message : err,
    );
  }

  // 2) Credit gate. Read the account's ledger and require the frontier weight.
  return creditGate(accountId);
}

async function creditGate(accountId: string): Promise<DiagnosisEntitlement> {
  let bal: number;
  try {
    const svc = serviceClient();
    const { data, error } = await svc
      .from('credit_ledger')
      .select('delta')
      .eq('account_id', accountId);
    if (error) throw new Error(error.message);
    const entries: LedgerEntry[] = (data ?? []).map((r) => ({
      delta: (r as { delta: number }).delta,
      reason: 'run',
    }));
    bal = balance(entries);
  } catch (err) {
    // Fail-closed: if we cannot prove a sufficient balance, refuse. Never spend
    // on an unreadable ledger.
    console.error(
      '[diagnosis-entitlement] ledger read failed — refusing (fail-closed)',
      err instanceof Error ? err.message : err,
    );
    return { kind: 'needs_credits', message: NEEDS_CREDITS_MESSAGE };
  }

  if (!canRun(bal, DIAGNOSIS_WEIGHT)) {
    return { kind: 'needs_credits', message: NEEDS_CREDITS_MESSAGE };
  }
  return { kind: 'charge' };
}

/**
 * Append the frontier run charge for a paid diagnosis. Best-effort against the
 * append-only ledger; the unique/overdraw guards live in the DB. The reason
 * the charge is advisory here (not transactional) matches the rest of the
 * pipeline: synthesis never breaks the surface. The credit GATE above is the
 * authority on whether the call is allowed.
 */
export async function chargeDiagnosis(accountId: string, runId: string): Promise<void> {
  try {
    const entry = chargeForRun(DIAGNOSIS_WEIGHT, runId);
    const svc = serviceClient();
    const { error } = await svc.from('credit_ledger').insert({
      account_id: accountId,
      delta: entry.delta,
      reason: entry.reason,
      run_id: runId,
    });
    if (error) throw new Error(error.message);
  } catch (err) {
    console.error(
      '[diagnosis-entitlement] charge insert failed',
      err instanceof Error ? err.message : err,
    );
  }
}

/** The weighted unit cost of one diagnosis (for callers/tests/copy). */
export const DIAGNOSIS_CREDIT_COST = WEIGHTS[DIAGNOSIS_WEIGHT];
