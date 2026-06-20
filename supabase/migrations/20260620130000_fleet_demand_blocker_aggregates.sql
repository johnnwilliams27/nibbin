-- Tier-2 fleet learning aggregates over the new instrumentation events
-- (capability_unfulfilled, connector_blocked from migration 20260620120000):
--   * demand_gap_signals — which capabilities users want but can't get
--     (no_capability / connector_not_connected), fleet-wide → roadmap input.
--   * connector_blocker_signals — which connectors block runs and why
--     (not_connected / auth_failed / velocity_cap) → reliability input.
-- Same privacy model as capability_task_performance / shop_template_performance:
-- anonymized + opt-out-gated (model_contribution_enabled) + k-anonymous (>=5
-- distinct contributing accounts) + staff-read-only (security_invoker view +
-- service_role RPC). Structural only — props carry capability ids / connector
-- names / reason codes, never content. No automated consumer (insight only).

create or replace view public.demand_gap_signals with (security_invoker = true) as
  select
    e.props->>'capability' as capability,
    e.props->>'reason' as reason,
    count(*) as occurrences,
    count(distinct e.account_id) as contributing_accounts,
    max(e.at) as last_seen
  from public.product_events e
    join public.accounts acc on acc.id = e.account_id and acc.model_contribution_enabled
  where e.name = 'capability_unfulfilled'
    and e.at > now() - interval '90 days'
    and e.props->>'capability' is not null
  group by 1, 2
  having count(distinct e.account_id) >= 5;

revoke all on public.demand_gap_signals from public, anon, authenticated;

create or replace function public.demand_gap_signals_read()
returns setof public.demand_gap_signals
language sql stable security definer set search_path = ''
as $$ select * from public.demand_gap_signals; $$;

revoke execute on function public.demand_gap_signals_read() from public, anon, authenticated;
grant execute on function public.demand_gap_signals_read() to service_role;

create or replace view public.connector_blocker_signals with (security_invoker = true) as
  select
    e.props->>'connector' as connector,
    e.props->>'reason' as reason,
    count(*) as occurrences,
    count(distinct e.account_id) as contributing_accounts,
    max(e.at) as last_seen
  from public.product_events e
    join public.accounts acc on acc.id = e.account_id and acc.model_contribution_enabled
  where e.name = 'connector_blocked'
    and e.at > now() - interval '90 days'
    and e.props->>'connector' is not null
  group by 1, 2
  having count(distinct e.account_id) >= 5;

revoke all on public.connector_blocker_signals from public, anon, authenticated;

create or replace function public.connector_blocker_signals_read()
returns setof public.connector_blocker_signals
language sql stable security definer set search_path = ''
as $$ select * from public.connector_blocker_signals; $$;

revoke execute on function public.connector_blocker_signals_read() from public, anon, authenticated;
grant execute on function public.connector_blocker_signals_read() to service_role;
