-- M6.5: model bring-up — durable frontier budget (#24), model-call COGS
-- ledger (§6.10/§6.12 admin view), and the C11 training opt-in flag.
--
-- Conventions follow M1..M5: RLS everywhere, client writes only through
-- security-definer RPCs, service role does the runtime work, anon gets
-- nothing.

-- ── durable per-user daily frontier budget (#24 — replaces the in-memory
--    store; `take` semantics match @nibbin/router BudgetStore exactly) ───────

create table public.frontier_budget (
  user_id uuid not null references public.users (id) on delete cascade,
  -- the USER-LOCAL calendar day the window covers (router computes the key)
  day_key date not null,
  used integer not null default 0 check (used >= 0),
  updated_at timestamptz not null default now(),
  primary key (user_id, day_key)
);

alter table public.frontier_budget enable row level security;
-- server plumbing: no client policies at all
revoke all on public.frontier_budget from anon, authenticated;

-- Atomic grant-and-increment: one statement, no read-then-write window.
-- Returns granted + the post-call used count (used stays at the cap on deny,
-- mirroring InMemoryBudgetStore).
create function public.frontier_budget_take(
  p_user uuid,
  p_day date,
  p_limit integer
)
returns table (granted boolean, used integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_used integer;
begin
  if p_limit is null or p_limit < 0 then
    raise exception 'frontier_budget_take: limit must be >= 0';
  end if;

  insert into public.frontier_budget as b (user_id, day_key, used)
  values (p_user, p_day, 1)
  on conflict (user_id, day_key) do update
    set used = b.used + 1, updated_at = now()
    where b.used < p_limit
  returning b.used into v_used;

  if v_used is null then
    -- conflict row existed and was at/over the limit: denied, nothing changed
    select b.used into v_used from public.frontier_budget b
      where b.user_id = p_user and b.day_key = p_day;
    return query select false, coalesce(v_used, 0);
    return;
  end if;

  -- the insert path grants even when p_limit = 0 would forbid it: guard that
  -- edge (first call of the day with a zero limit must deny, not seed used=1)
  if v_used > p_limit then
    update public.frontier_budget b
      set used = b.used - 1, updated_at = now()
      where b.user_id = p_user and b.day_key = p_day;
    return query select false, v_used - 1;
    return;
  end if;

  return query select true, v_used;
end;
$$;
revoke execute on function public.frontier_budget_take(uuid, date, integer) from public, anon, authenticated;
grant execute on function public.frontier_budget_take(uuid, date, integer) to service_role;

create function public.frontier_budget_used(p_user uuid, p_day date)
returns integer
language sql
security definer
set search_path = ''
stable
as $$
  select coalesce((select used from public.frontier_budget where user_id = p_user and day_key = p_day), 0);
$$;
revoke execute on function public.frontier_budget_used(uuid, date) from public, anon, authenticated;
grant execute on function public.frontier_budget_used(uuid, date) to service_role;

-- ── model-call COGS ledger (§6.10 admin COGS view, §6.12 margins) ───────────
-- One row per real model call. Token counts + the cache split are the raw
-- material for per-account COGS and the M6.5 pricing measurement; cost is
-- computed in code from config-pinned rates and stored denormalized so the
-- admin view never needs price history.
--
-- Retention: operational telemetry, account-scoped, cascades with the
-- account (§6.11 ≤30d clock). Never carries prompt or completion text.

create table public.model_calls (
  id uuid primary key default gen_random_uuid(),
  account_id uuid references public.accounts (id) on delete cascade,
  user_id uuid references public.users (id) on delete set null,
  run_id uuid references public.runs (id) on delete set null,
  tier text not null check (tier in ('t0', 't1', 't2')),
  task text not null check (btrim(task) <> ''),
  model text not null check (btrim(model) <> ''),
  input_tokens integer not null default 0 check (input_tokens >= 0),
  cache_write_tokens integer not null default 0 check (cache_write_tokens >= 0),
  cache_read_tokens integer not null default 0 check (cache_read_tokens >= 0),
  output_tokens integer not null default 0 check (output_tokens >= 0),
  -- micro-USD (1e-6 USD) so integer math stays exact at fractions of a cent
  cost_microusd bigint not null default 0 check (cost_microusd >= 0),
  created_at timestamptz not null default now()
);
create index model_calls_account_idx on public.model_calls (account_id, created_at);
create index model_calls_created_idx on public.model_calls (created_at);

alter table public.model_calls enable row level security;
-- server plumbing: no client policies (the admin console reads via service
-- role on admin.nibbin.com; members see credits, not raw COGS)
revoke all on public.model_calls from anon, authenticated;

-- One aggregate for the §6.10 admin COGS card (service role only — members
-- see credits, never raw provider economics).
create function public.account_model_cogs(p_account uuid, p_days integer default 30)
returns table (
  calls bigint,
  input_tokens bigint,
  cache_write_tokens bigint,
  cache_read_tokens bigint,
  output_tokens bigint,
  cost_microusd bigint
)
language sql
security definer
set search_path = ''
stable
as $$
  select count(*),
         coalesce(sum(m.input_tokens), 0),
         coalesce(sum(m.cache_write_tokens), 0),
         coalesce(sum(m.cache_read_tokens), 0),
         coalesce(sum(m.output_tokens), 0),
         coalesce(sum(m.cost_microusd), 0)
    from public.model_calls m
   where m.account_id = p_account
     and m.created_at > now() - make_interval(days => greatest(p_days, 1));
$$;
revoke execute on function public.account_model_cogs(uuid, integer) from public, anon, authenticated;
grant execute on function public.account_model_cogs(uuid, integer) to service_role;

-- ── C11 training opt-in (#24 condition: ships with the first real generate) ─
-- Default OFF; flipping it is an explicit, audited account-level act. The
-- flag gates any FUTURE training use of account content; model providers are
-- contractually barred regardless (SPEC §2 C11).

alter table public.accounts
  add column training_opt_in boolean not null default false;

create function public.set_training_opt_in(target_account uuid, opted_in boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
begin
  if uid is null then
    raise exception 'not authenticated';
  end if;
  if not (select private.is_account_member(target_account)) then
    raise exception 'not a member of this account';
  end if;
  update public.accounts set training_opt_in = opted_in where id = target_account;
  insert into public.audit_log (account_id, actor, actor_id, action, subject, meta)
  values (target_account, 'user', uid::text, 'account.training_opt_in_set', target_account::text,
    jsonb_build_object('opted_in', opted_in));
end;
$$;
revoke execute on function public.set_training_opt_in(uuid, boolean) from public, anon, service_role;
grant execute on function public.set_training_opt_in(uuid, boolean) to authenticated;
