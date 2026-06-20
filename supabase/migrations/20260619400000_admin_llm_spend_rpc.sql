-- Admin staff accounts list: 30-day per-account LLM spend.
--
-- The admin list previously pulled EVERY model_calls row from the last 30 days
-- to the app and summed in JS. That transfers one row per call (unbounded as
-- usage grows). This RPC does the aggregation in Postgres and returns one row
-- per account instead. The admin app uses the service-role client, but the
-- function is security-definer + service_role-only so it never widens access.
--
-- No new index needed: model_calls already has model_calls_account_idx
-- (account_id, created_at) — which covers this GROUP-BY-account + 30-day-range
-- query — plus model_calls_created_idx (created_at).

create or replace function public.admin_account_llm_spend_30d()
returns table (account_id uuid, total_microusd numeric)
language sql
stable
security definer
set search_path = ''
as $$
  select mc.account_id, sum(mc.cost_microusd)::numeric as total_microusd
  from public.model_calls mc
  where mc.created_at >= now() - interval '30 days'
  group by mc.account_id
$$;

revoke all on function public.admin_account_llm_spend_30d() from public, anon, authenticated;
grant execute on function public.admin_account_llm_spend_30d() to service_role;
