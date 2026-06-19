-- supabase/migrations/20260619120000_channel_anomaly_baseline.sql
-- AS-§18.4 adaptive baseline for channel inbound volume. Replaces the fixed
-- hourly cap: compares today's verified inbound count for (account, channel)
-- against the trailing 7-day daily average; anomalous when today exceeds
-- max(floor, ceil(multiplier * baseline)). Mirrors private.run_admission_block.
create or replace function public.channel_inbound_anomaly(
  p_account uuid,
  p_channel text,
  p_multiplier numeric default 10,
  p_floor int default 5
)
returns table (is_anomalous boolean, today_count int, baseline_per_day numeric)
language sql
stable
security definer
set search_path = ''
as $$
  with baseline as (
    select count(*) / 7.0 as per_day
    from public.channel_messages
    where account_id = p_account and channel = p_channel
      and direction = 'inbound' and verified = true
      and created_at >= date_trunc('day', now() at time zone 'utc') - interval '7 days'
      and created_at <  date_trunc('day', now() at time zone 'utc')
  ),
  today as (
    select count(*)::int as cnt
    from public.channel_messages
    where account_id = p_account and channel = p_channel
      and direction = 'inbound' and verified = true
      and created_at >= date_trunc('day', now() at time zone 'utc')
  )
  select
    today.cnt > greatest(p_floor, ceil(p_multiplier * baseline.per_day)),
    today.cnt,
    round(baseline.per_day, 2)
  from baseline, today;
$$;
revoke execute on function public.channel_inbound_anomaly(uuid, text, numeric, int) from public, anon, authenticated;
grant execute on function public.channel_inbound_anomaly(uuid, text, numeric, int) to service_role;
