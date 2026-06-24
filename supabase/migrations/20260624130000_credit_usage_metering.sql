-- Usage-based credit metering (feat/credit-metering-usage).
--
-- WHY: today credits only decrement on agent "runs" (a flat weighted -1/-3/-10
-- charged at run_begin). Every NON-run model call — chat turns, onboarding
-- understanding, planner plan synthesis, doc/vision extraction, style learning,
-- memory derivation — records a model_calls COGS row but charges NOTHING. Most
-- paid model usage was therefore free. This migration adds a 'usage' ledger
-- reason and a service-role RPC that converts a recorded call's micro-USD COGS
-- into credits and appends one usage debit per (non-run) call.
--
-- DESIGN (reconciles the existing flat run charge — no double charge):
--   * The two surfaces that post a flat per-run charge (Nibbin run_begin and
--     diagnosis / chargeDiagnosis) cover their own model calls, so recordModelCall
--     skips usage for those (flagged in app code as flatCharged). EVERY other call
--     usage-charges — including the planner ReAct loop, which carries a run_id but
--     posts no flat charge. (We charge on NOT-flat-charged, not on run_id absence.)
--   * Usage charges are POST-HOC and may drive the balance NEGATIVE — a model
--     call that already completed ALWAYS records its charge and its result
--     posts, even for a broke account (the soft-gate protects completed work).
--     Only STARTING new expensive work (a Nibbin run / planner run) checks the
--     balance up front and refuses if broke. So 'usage', like 'clawback', is
--     exempt from the overdraw guard.
--
-- CONVENTIONS follow M1..M6.5: append-only credit_ledger, RLS everywhere,
-- client writes only through security-definer RPCs / service role, anon nothing.

-- ── 'usage' becomes a first-class debit reason ──────────────────────────────
-- It debits (negative delta) like 'run'/'clawback'. It carries run_id NULL
-- (the ledger row is per-call, not per-run) and source_id = the model_calls row
-- id for one-to-one auditability + replay-dedup.

alter table public.credit_ledger drop constraint if exists credit_ledger_reason_check;
alter table public.credit_ledger
  add constraint credit_ledger_reason_check
  check (reason in ('run', 'topup', 'grant', 'refund', 'clawback', 'usage'));

alter table public.credit_ledger drop constraint if exists credit_ledger_sign_by_reason;
alter table public.credit_ledger
  add constraint credit_ledger_sign_by_reason check (
    (reason in ('run', 'clawback', 'usage') and delta < 0)
    or (reason in ('topup', 'grant', 'refund') and delta > 0)
  );

-- One usage debit per model_calls row: source_id is the call id. A unique index
-- makes the charge idempotent — a retried recordModelCall can never double-debit.
create unique index if not exists credit_ledger_one_usage_per_call
  on public.credit_ledger (source_id) where reason = 'usage';

-- ── the conversion constant lives in code (packages/shared USD_PER_CREDIT); the
--    RPC takes the already-computed credit amount so the price is defined ONCE.
--    charge_model_usage(account, model_calls id, credits>0) appends the debit.
--    Idempotent on the call id; may overdraw (soft-gate); service-role only. ──

create or replace function public.charge_model_usage(
  p_account uuid,
  p_call_id uuid,
  p_credits integer
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- A near-free call rounds to 0 credits — nothing to charge (NOT an error).
  if p_credits is null or p_credits <= 0 then
    return;
  end if;
  if p_account is null then
    return; -- account-less calls (e.g. unattributed system pings) are not billed
  end if;

  -- Idempotent: the partial unique index on (source_id) where reason='usage'
  -- turns a replay into a no-op rather than a double charge.
  insert into public.credit_ledger (account_id, delta, reason, source_id)
  values (p_account, -p_credits, 'usage', p_call_id::text)
  on conflict do nothing;
end;
$$;
revoke execute on function public.charge_model_usage(uuid, uuid, integer) from public, anon, authenticated;
grant execute on function public.charge_model_usage(uuid, uuid, integer) to service_role;
