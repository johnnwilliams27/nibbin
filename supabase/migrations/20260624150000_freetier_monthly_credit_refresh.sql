-- Free-tier ("Hatchling") monthly credit refill (feat/freetier-credit-refresh).
--
-- WHY: usage metering (#259, migration 20260624130000) now charges credits on
-- ALL model usage. Paid tiers (grove/canopy) receive their monthly allowance
-- from the Stripe webhook on each paid invoice; the free Hatchling tier pays no
-- invoice, so once it spends its initial 100 credits it stays at (or below)
-- zero forever. This adds a service-role RPC that a monthly cron calls to top
-- free accounts back UP TO their monthly allotment.
--
-- A DEDICATED 'refill' REASON (not 'grant'): a refill is a VARIABLE top-up
-- deficit (e.g. 30, 70), whereas 'grant' is a FIXED paid tier amount the app
-- layer validates against the tier table (packages/shared GRANT_AMOUNTS). Using
-- a distinct reason (a) preserves the "grant => tier amount" invariant the rest
-- of the codebase enforces (adversarial gate F1/P2 — three reviewers), and (b)
-- keeps free and paid idempotency keys in disjoint index spaces.
--
-- SEMANTICS — "top UP to the allotment", not "add the allotment" (mirrors
-- packages/shared freeRefreshDelta):
--   * For each Hatchling account, refill `least(allotment, greatest(0,
--     allotment - balance))`. A dormant account is refilled to the allotment
--     (never 2N/3N); an account already at/above gets nothing (no stacking, and
--     a churn-reset can never push a balance above the cap); a NEGATIVE balance
--     (usage soft-gate) is forgiven only up to ONE allotment (the least() cap),
--     so a deep overdraft is not fully wiped (gate logic-skeptic P2).
--   * The refill row carries source_id = 'freemonthly_' || p_period and is
--     deduped by the unique index credit_ledger_one_refill_per_period
--     (account_id, source_id) where reason='refill' + on conflict do nothing, so
--     a same-period re-run (Vercel double-invoke / manual re-run) is a no-op.
--
-- TIER TARGETING: an account is Hatchling iff its subscriptions.tier = 'hatchling'
-- (subscriptions.account_id is UNIQUE, so the LEFT JOIN cannot fan out). An
-- account with NO subscription row is treated as free/Hatchling (a fresh signup
-- before any Stripe object exists). A grove/canopy account is never matched, so
-- a paid account can never receive a free refill.
--
-- NOTE on a known bounded behavior (gate logic-skeptic P1, accepted): a free
-- account that UPGRADES later in the same calendar month it was already refilled
-- keeps that one refill (we never claw it back) and also receives its paid
-- grant — at most one free allotment (100cr / $1) of extra credit, that month
-- only. Documented in the gate report; not clawed back to avoid a risky
-- cross-event reversal for a $1 edge.
--
-- SECURITY/CONVENTIONS (M1..#259): append-only credit_ledger, RLS everywhere,
-- writes only through security-definer RPCs / service role. set search_path = ''.
-- The allotment is passed in by the caller (one source of truth in
-- packages/shared) so the dollar/credit value is defined ONCE in code.
--
-- Replay-safe DDL (known migration-tracker drift across dev/staging/prod):
-- drop-if-exists + create-if-not-exists + create-or-replace. This migration
-- DEPENDS on M7 (20260614120000, accounts.purged_at / purge_after) and the M1
-- credit_ledger — both precede it in this directory; verify they are applied on
-- dev/staging/prod before relying on the cron.

-- ── 'refill' becomes a first-class credit reason (positive delta, like grant) ──
alter table public.credit_ledger drop constraint if exists credit_ledger_reason_check;
alter table public.credit_ledger
  add constraint credit_ledger_reason_check
  check (reason in ('run', 'topup', 'grant', 'refund', 'clawback', 'usage', 'refill'));

alter table public.credit_ledger drop constraint if exists credit_ledger_sign_by_reason;
alter table public.credit_ledger
  add constraint credit_ledger_sign_by_reason check (
    (reason in ('run', 'clawback', 'usage') and delta < 0)
    or (reason in ('topup', 'grant', 'refund', 'refill') and delta > 0)
  );

-- A refill must carry its period source_id (idempotency key).
alter table public.credit_ledger drop constraint if exists credit_ledger_refill_period;
alter table public.credit_ledger
  add constraint credit_ledger_refill_period check (reason <> 'refill' or source_id is not null);

-- One refill per (account, period): a retried/duplicate cron run is a no-op.
create unique index if not exists credit_ledger_one_refill_per_period
  on public.credit_ledger (account_id, source_id) where reason = 'refill';

-- ── refresh_free_tier_credits(period, allotment): set-based, atomic, idempotent.
--    The credit/allotment value is defined ONCE in code (packages/shared) and
--    passed in. Service-role only. ───────────────────────────────────────────

create or replace function public.refresh_free_tier_credits(
  p_period text,
  p_allotment integer
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_source_id text;
  v_refilled integer := 0;
begin
  if p_period is null or btrim(p_period) = '' then
    raise exception 'refresh_free_tier_credits: p_period must be a non-blank period key';
  end if;
  if p_allotment is null or p_allotment <= 0 then
    raise exception 'refresh_free_tier_credits: p_allotment must be a positive integer';
  end if;

  v_source_id := 'freemonthly_' || p_period;

  -- Single statement → atomic. For every free account, compute its balance and
  -- refill the deficit, CAPPED at one allotment. on conflict do nothing dedupes
  -- the (account_id, source_id) refill per period.
  with free_accounts as (
    select a.id as account_id
    from public.accounts a
    left join public.subscriptions s on s.account_id = a.id
    -- Hatchling, or no subscription row yet (fresh free signup). Never paid.
    where coalesce(s.tier, 'hatchling') = 'hatchling'
      -- Exclude accounts in deletion: already purged, or in the grace window
      -- (purge_after set). Don't refill credits an account can't use. The M7
      -- columns are referenced unconditionally — this migration depends on M7.
      and a.purged_at is null
      and a.purge_after is null
  ),
  balances as (
    select fa.account_id,
           coalesce(sum(l.delta), 0)::integer as balance
    from free_accounts fa
    left join public.credit_ledger l on l.account_id = fa.account_id
    group by fa.account_id
  ),
  to_refill as (
    select account_id,
           least(p_allotment, p_allotment - balance) as deficit
    from balances
    where (p_allotment - balance) > 0
  ),
  inserted as (
    insert into public.credit_ledger (account_id, delta, reason, source_id)
    select account_id, deficit, 'refill', v_source_id
    from to_refill
    on conflict do nothing
    returning 1
  )
  select count(*)::integer into v_refilled from inserted;

  return v_refilled;
end;
$$;

revoke execute on function public.refresh_free_tier_credits(text, integer) from public, anon, authenticated;
grant execute on function public.refresh_free_tier_credits(text, integer) to service_role;
