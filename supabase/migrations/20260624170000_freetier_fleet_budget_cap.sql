-- Fleet-level free-tier spend kill-switch (feat/freetier-credit-refresh, PR #262).
--
-- WHY: 20260624150000 added a monthly cron that tops every free Hatchling account
-- UP TO its 100-credit ($1) allotment. Per-account exposure is bounded by metering
-- (the refill is capped at one allotment), but the AGGREGATE free-tier spend scales
-- LINEARLY with free signups: 10k free accounts ⇒ up to $10k/month, unbounded by a
-- GTM signup spike. The owner (John) decided NOT to ship the recurring giveaway
-- without a fleet-level ceiling. This migration adds that guardrail INSIDE the
-- set-based RPC so it is atomic (not racy across concurrent invocations).
--
-- WHAT THIS ADDS
--   1. A NEW signature refresh_free_tier_credits(p_period, p_allotment, p_budget):
--      grant free refills in deterministic account order (oldest first) until the
--      PERIOD budget is exhausted, then STOP (fail-safe: skip the remaining
--      accounts, do NOT error the job). The budget bounds TOTAL refill credits
--      granted per calendar period across ALL accounts.
--      - Idempotent: refills ALREADY inserted this period (deduped by the
--        20260624150000 partial unique index) COUNT toward the budget, so a re-run
--        never double-spends the cap.
--      - Returns jsonb { refilled, granted_credits, capped, budget, period } so the
--        cron can log/alert. (The old integer-returning 2-arg signature is dropped;
--        the route now calls the 3-arg form.)
--   2. emit_product_event allowlist gains 'freetier_budget_capped' — an observable
--      telemetry/alert event emitted (fleet-level, p_account = NULL) when the cap
--      is reached in a period. Recreated from the LIVE function; the ONLY change is
--      the one new name in the IN-list (full current allowlist preserved verbatim).
--
-- Replay-safe DDL (known migration-tracker drift across dev/staging/prod):
-- drop-if-exists + create-or-replace. Depends on 20260624150000 (the refill reason,
-- CHECKs and the credit_ledger_one_refill_per_period unique index) — which precedes
-- it in this directory.
--
-- NOT applied to remote yet — apply on dev/staging/prod at merge time.

-- ── emit_product_event: add 'freetier_budget_capped' to the allowlist ──────────
-- Recreated from the live function (membership gate + drip regex preserved); the
-- ONLY change is the new name. If the live allowlist drifts, re-query it before
-- editing — adding here without the full current list would silently DROP names.
create or replace function public.emit_product_event(p_account uuid, p_name text, p_props jsonb default '{}'::jsonb)
returns void
language plpgsql
security definer
set search_path to ''
as $function$
declare uid uuid := (select auth.uid());
begin
  if p_name not in (
    'account_created', 'connector_linked', 'scan_completed', 'scan_empty', 'nibbin_adopted',
    'first_draft_approved', 'run_approved', 'run_edited', 'run_rejected', 'stage_promoted',
    'stage_demoted', 'study_started', 'study_completed', 'study_aborted', 'diagnosis_viewed',
    'plan_upgraded', 'topup_purchased', 'capability_unfulfilled', 'connector_blocked',
    'freetier_budget_capped'
  ) and p_name !~ '^drip_[a-z0-9_]+_(sent|opened)$' then
    raise exception 'unknown product event %', p_name;
  end if;
  if uid is not null and (p_account is null or not (select private.is_account_member(p_account))) then
    raise exception 'cannot emit events for this account';
  end if;
  insert into public.product_events (account_id, user_id, name, props)
  values (p_account, uid, p_name, coalesce(p_props, '{}'::jsonb));
end;
$function$;

-- ── refresh_free_tier_credits(period, allotment, budget): budget-capped refill ──
-- Drop the old 2-arg signature so the function has exactly one shape (the route is
-- updated to call the 3-arg form). Postgres keys functions by argument types, so
-- the new 3-arg create does NOT replace the 2-arg one — drop it explicitly.
drop function if exists public.refresh_free_tier_credits(text, integer);

create or replace function public.refresh_free_tier_credits(
  p_period text,
  p_allotment integer,
  p_budget integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_source_id   text;
  v_already     integer := 0;   -- refill credits already granted this period
  v_remaining   integer;        -- budget headroom left for this run
  v_granted     integer := 0;   -- credits granted by THIS run
  v_refilled    integer := 0;   -- accounts refilled by THIS run
  v_capped      boolean := false;
begin
  if p_period is null or btrim(p_period) = '' then
    raise exception 'refresh_free_tier_credits: p_period must be a non-blank period key';
  end if;
  if p_allotment is null or p_allotment <= 0 then
    raise exception 'refresh_free_tier_credits: p_allotment must be a positive integer';
  end if;
  if p_budget is null or p_budget < 0 then
    raise exception 'refresh_free_tier_credits: p_budget must be a non-negative integer';
  end if;

  v_source_id := 'freemonthly_' || p_period;

  -- SERIALIZE same-period invocations. The budget accounting reads v_already in
  -- one statement and grants in a separate statement; under READ COMMITTED two
  -- concurrent runs (Vercel cron double-invoke, or a manual re-run racing the
  -- scheduled fire) could each read the same v_already pre-insert and each grant
  -- up to v_remaining — overshooting the fleet budget by up to ~1x. A
  -- period-scoped transaction advisory lock makes the second caller block until
  -- the first commits, so it then reads the updated v_already and correctly sees
  -- reduced/zero headroom. Cheap (released at txn end) and the job runs monthly,
  -- so there is no real contention. This is what makes the cap atomic across
  -- concurrent invocations, not just sequential re-runs.
  perform pg_advisory_xact_lock(hashtextextended('freetier_refresh:' || p_period, 0));

  -- Credits already granted this period (a prior run, now committed under the
  -- lock above). These COUNT toward the cap so a re-run never lets the fleet
  -- spend past the budget.
  select coalesce(sum(l.delta), 0)::integer
    into v_already
    from public.credit_ledger l
   where l.reason = 'refill' and l.source_id = v_source_id;

  v_remaining := greatest(p_budget - v_already, 0);

  -- ONE atomic statement. For every eligible free account (deterministic order:
  -- oldest first), compute its capped deficit, then do a GREEDY PARTIAL FILL of
  -- the remaining budget: each account in turn gets least(deficit, headroom left
  -- before it). This grants the budget oldest-first WITHOUT head-of-line
  -- starvation — a single large-deficit account at the front cannot block the
  -- smaller accounts behind it (the boundary account simply takes a partial
  -- refill and advances next period), and 100% of the headroom is used. A
  -- partial refill is still a valid 'refill' row (>0 and <= one allotment).
  --
  -- The capped flag is derived from the PRE-insert wanted total vs the budget
  -- headroom — captured in the same CTE chain so it can't be distorted by the
  -- rows this run just inserted. on conflict do nothing dedupes the per-period
  -- refill (idempotent re-run): a prior partial grant raises v_already (shrinking
  -- v_remaining) AND raises that account's balance (shrinking its next deficit),
  -- so re-runs converge without ever exceeding the cap.
  with free_accounts as (
    select a.id as account_id, a.created_at
    from public.accounts a
    left join public.subscriptions s on s.account_id = a.id
    where coalesce(s.tier, 'hatchling') = 'hatchling'
      and a.purged_at is null
      and a.purge_after is null
  ),
  balances as (
    select fa.account_id, fa.created_at,
           coalesce(sum(l.delta), 0)::integer as balance
    from free_accounts fa
    left join public.credit_ledger l on l.account_id = fa.account_id
    group by fa.account_id, fa.created_at
  ),
  to_refill as (
    select account_id, created_at,
           least(p_allotment, p_allotment - balance) as deficit
    from balances
    where (p_allotment - balance) > 0
  ),
  -- The full deficit that WANTED granting this run (pre-insert). Drives the cap.
  wanted as (
    select coalesce(sum(deficit), 0)::integer as total_wanted from to_refill
  ),
  ranked as (
    -- EXCLUSIVE running total (deficit of all OLDER accounts, not incl. self).
    -- Ties on created_at broken by id for a fully-deterministic, stable order.
    select account_id, deficit,
           coalesce(
             sum(deficit) over (order by created_at, account_id
                                rows between unbounded preceding and 1 preceding),
             0) as prior_cumulative
    from to_refill
  ),
  granted as (
    -- Greedy partial fill: grant min(deficit, headroom remaining before this
    -- account). Accounts past the budget get 0 and are dropped by the > 0 filter.
    select account_id,
           least(deficit, greatest(v_remaining - prior_cumulative, 0)) as grant_amount
    from ranked
  ),
  inserted as (
    insert into public.credit_ledger (account_id, delta, reason, source_id)
    select account_id, grant_amount, 'refill', v_source_id
    from granted
    where grant_amount > 0
    on conflict do nothing
    returning delta
  ),
  ins_agg as (
    select coalesce(count(*), 0)::integer as n,
           coalesce(sum(delta), 0)::integer as credits
    from inserted
  )
  select ins_agg.n,
         ins_agg.credits,
         -- Capped iff some wanted deficit could NOT fit under the headroom.
         (wanted.total_wanted > v_remaining)
    into v_refilled, v_granted, v_capped
    from ins_agg, wanted;

  -- A deliberate operator pause (budget 0, nothing granted yet this period) is
  -- NOT a budget-exhaustion alert — don't emit the capped event for it. The
  -- event fires only when a NON-ZERO ceiling actually clipped wanted spend.
  if v_capped and v_remaining = 0 and v_already = 0 and p_budget = 0 then
    v_capped := false;
  end if;

  if v_capped then
    -- Fleet-level alert (no account scope; service-role context → auth.uid() null
    -- so the membership gate is bypassed by design). Best-effort: never fail the
    -- whole refill job because telemetry insert hiccuped.
    begin
      perform public.emit_product_event(
        null,
        'freetier_budget_capped',
        jsonb_build_object(
          'period', p_period,
          'budget', p_budget,
          'granted_credits', v_already + v_granted,
          'accounts_refilled', v_refilled
        )
      );
    exception when others then
      raise warning 'freetier_budget_capped event emit failed: %', sqlerrm;
    end;
  end if;

  return jsonb_build_object(
    'refilled', v_refilled,
    'granted_credits', v_granted,
    'capped', v_capped,
    'budget', p_budget,
    'period', p_period
  );
end;
$$;

revoke execute on function public.refresh_free_tier_credits(text, integer, integer) from public, anon, authenticated;
grant execute on function public.refresh_free_tier_credits(text, integer, integer) to service_role;
