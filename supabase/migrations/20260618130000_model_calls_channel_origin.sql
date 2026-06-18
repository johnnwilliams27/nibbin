-- N17: tag every LLM turn with where it came from. origin distinguishes
-- user-initiated chat from pipeline/agent work; channel records the reach-me
-- surface ('telegram','sms','whatsapp', or null for in-app/web). Additive +
-- nullable so existing inserts keep working.
alter table public.model_calls add column origin text check (origin in ('chat', 'pipeline'));
alter table public.model_calls add column channel text
  check (channel is null or channel in ('push','email','sms','telegram','whatsapp','in_app'));
create index model_calls_channel_idx on public.model_calls (account_id, channel, created_at);

-- channel-scoped COGS (for the §11 spend caps + admin visibility)
create or replace function public.account_channel_cogs(p_account uuid, p_channel text, p_days integer default 1)
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
    and created_at > now() - make_interval(days => p_days);
$$;
revoke execute on function public.account_channel_cogs(uuid, text, integer) from public, anon;
grant execute on function public.account_channel_cogs(uuid, text, integer) to authenticated, service_role;
