-- #230: anti-runaway daily CHAT ceiling. Generalize frontier_budget with a
-- `kind` discriminator so one (user, day) window can hold two independent
-- atomic counters:
--   'frontier'   — the existing T2-from-chat budget (default; back-compatible)
--   'chat_total' — the new all-tier daily chat ceiling (every chat turn counts)
-- A T2 chat turn draws BOTH. The ceiling is a SAFETY backstop (generous,
-- plan-scaled in app code via CHAT_DAILY_CEILING), never a credit meter: hitting
-- it pauses chat for the UTC day and never debits run-credits.

alter table public.frontier_budget
  add column if not exists kind text not null default 'frontier'
    check (kind in ('frontier', 'chat_total'));

-- Repoint the primary key to include kind (existing rows default to 'frontier').
alter table public.frontier_budget drop constraint frontier_budget_pkey;
alter table public.frontier_budget add primary key (user_id, day_key, kind);

-- take/used gain a p_kind param. Default 'frontier' so any in-flight 3-arg
-- PostgREST caller (pre-deploy) still resolves through the rollout. Drop+recreate
-- because adding a parameter changes the function signature.
drop function if exists public.frontier_budget_take(uuid, date, integer);
create function public.frontier_budget_take(
  p_user uuid,
  p_day date,
  p_limit integer,
  p_kind text default 'frontier'
)
returns table (granted boolean, used integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_used integer;
begin
  if p_limit < 0 then
    raise exception 'frontier_budget_take: limit must be >= 0';
  end if;

  insert into public.frontier_budget as b (user_id, day_key, kind, used)
  values (p_user, p_day, p_kind, 1)
  on conflict (user_id, day_key, kind) do update
    set used = b.used + 1, updated_at = now()
    where b.used < p_limit
  returning b.used into v_used;

  if v_used is null then
    -- conflict row existed and was at/over the limit: denied, nothing changed
    select b.used into v_used from public.frontier_budget b
      where b.user_id = p_user and b.day_key = p_day and b.kind = p_kind;
    return query select false, coalesce(v_used, 0);
    return;
  end if;

  -- the insert path grants even when p_limit = 0 would forbid it: guard that
  -- edge (first call of the day with a zero limit must deny, not seed used=1)
  if v_used > p_limit then
    update public.frontier_budget b
      set used = b.used - 1, updated_at = now()
      where b.user_id = p_user and b.day_key = p_day and b.kind = p_kind;
    return query select false, v_used - 1;
    return;
  end if;

  return query select true, v_used;
end;
$$;
revoke execute on function public.frontier_budget_take(uuid, date, integer, text) from public, anon, authenticated;
grant execute on function public.frontier_budget_take(uuid, date, integer, text) to service_role;

drop function if exists public.frontier_budget_used(uuid, date);
create function public.frontier_budget_used(p_user uuid, p_day date, p_kind text default 'frontier')
returns integer
language sql
security definer
set search_path = ''
stable
as $$
  select coalesce((select used from public.frontier_budget
    where user_id = p_user and day_key = p_day and kind = p_kind), 0);
$$;
revoke execute on function public.frontier_budget_used(uuid, date, text) from public, anon, authenticated;
grant execute on function public.frontier_budget_used(uuid, date, text) to service_role;
