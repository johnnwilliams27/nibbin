-- §11 budgets. A channel-initiated conversational turn (an LLM call) is metered
-- exactly like in-app work: it draws on the same credit system AND is bounded by
-- a per-day turn budget and a per-channel spend cap (the metered SMS sub-cap is
-- the tightest). Fail-closed: channel_turn_take returns granted=false at the cap.
create table public.account_spend (
  account_id uuid not null references public.accounts (id) on delete cascade,
  day_key date not null,
  conversation_turns int not null default 0 check (conversation_turns >= 0),
  primary key (account_id, day_key)
);
alter table public.account_spend enable row level security;
create policy account_spend_member_read on public.account_spend
  for select to authenticated using ((select private.is_account_member(account_id)));
revoke all on public.account_spend from anon;
revoke insert, update, delete, truncate, references, trigger on public.account_spend from authenticated;

create or replace function public.channel_turn_take(
  p_account uuid,
  p_day date,
  p_turn_limit int,
  p_channel text,
  p_channel_spend_cap_microusd bigint
)
returns table (granted boolean, turns int, channel_spent bigint)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_turns int;
  v_spent bigint := public.account_channel_cogs(p_account, p_channel, 1);
begin
  insert into public.account_spend (account_id, day_key, conversation_turns)
  values (p_account, p_day, 0)
  on conflict (account_id, day_key) do nothing;

  select conversation_turns into v_turns
    from public.account_spend
   where account_id = p_account and day_key = p_day
   for update;

  if v_turns >= p_turn_limit or v_spent >= p_channel_spend_cap_microusd then
    return query select false, v_turns, v_spent;
    return;
  end if;

  update public.account_spend
     set conversation_turns = conversation_turns + 1
   where account_id = p_account and day_key = p_day
   returning conversation_turns into v_turns;
  return query select true, v_turns, v_spent;
end;
$$;
revoke execute on function public.channel_turn_take(uuid, date, int, text, bigint) from public, anon, authenticated;
grant execute on function public.channel_turn_take(uuid, date, int, text, bigint) to service_role;
