-- supabase/migrations/20260619110000_channel_spend_window_align.sql
-- (a) Align the channel spend window to the SAME UTC calendar day as the turn
--     counter (account_spend.day_key), replacing the rolling-24h read.
-- (b) Add a one-time ~80% soft-warn: granted continues, but the first granted
--     turn that crosses 80% of the cap on a given (account, channel, day)
--     returns warn=true so the caller can nudge the user once. Hard block at
--     100% is unchanged (fail-closed).

-- Calendar-day channel COGS in UTC (keeps the rolling account_channel_cogs for
-- admin/visibility callers untouched).
create or replace function public.account_channel_cogs_day(p_account uuid, p_channel text, p_day date)
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(sum(cost_microusd), 0)::bigint
  from public.model_calls
  where account_id = p_account
    and (p_channel is null or channel = p_channel)
    and (created_at at time zone 'utc')::date = p_day;
$$;
revoke execute on function public.account_channel_cogs_day(uuid, text, date) from public, anon;
grant execute on function public.account_channel_cogs_day(uuid, text, date) to authenticated, service_role;

-- One-time soft-warn dedup, per (account, channel, calendar day).
create table public.channel_spend_notice (
  account_id uuid not null references public.accounts (id) on delete cascade,
  channel text not null,
  day_key date not null,
  created_at timestamptz not null default now(),
  primary key (account_id, channel, day_key)
);
alter table public.channel_spend_notice enable row level security;
revoke all on public.channel_spend_notice from anon, authenticated;

-- Re-create channel_turn_take with the day-aligned spend read + warn flag.
-- NOTE: return type changes (adds warn column) — drop the old function first,
-- then create the new one (create or replace cannot change return type).
drop function if exists public.channel_turn_take(uuid, date, int, text, bigint);
create function public.channel_turn_take(
  p_account uuid,
  p_day date,
  p_turn_limit int,
  p_channel text,
  p_channel_spend_cap_microusd bigint
)
returns table (granted boolean, turns int, channel_spent bigint, warn boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_turns int;
  v_spent bigint := public.account_channel_cogs_day(p_account, p_channel, p_day);
  v_warn boolean := false;
  v_inserted int;
begin
  insert into public.account_spend (account_id, day_key, conversation_turns)
  values (p_account, p_day, 0)
  on conflict (account_id, day_key) do nothing;

  select conversation_turns into v_turns
    from public.account_spend
   where account_id = p_account and day_key = p_day
   for update;

  if v_turns >= p_turn_limit or v_spent >= p_channel_spend_cap_microusd then
    return query select false, v_turns, v_spent, false;
    return;
  end if;

  -- granted: increment the turn counter
  update public.account_spend
     set conversation_turns = conversation_turns + 1
   where account_id = p_account and day_key = p_day
   returning conversation_turns into v_turns;

  -- one-time ~80% soft-warn on this (account, channel, day)
  if v_spent >= ceil(0.8 * p_channel_spend_cap_microusd) then
    insert into public.channel_spend_notice (account_id, channel, day_key)
    values (p_account, p_channel, p_day)
    on conflict do nothing;
    get diagnostics v_inserted = row_count;
    v_warn := v_inserted = 1;
  end if;

  return query select true, v_turns, v_spent, v_warn;
end;
$$;
revoke execute on function public.channel_turn_take(uuid, date, int, text, bigint) from public, anon, authenticated;
grant execute on function public.channel_turn_take(uuid, date, int, text, bigint) to service_role;
