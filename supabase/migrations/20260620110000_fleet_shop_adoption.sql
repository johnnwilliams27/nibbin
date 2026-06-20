-- Tier-2 fleet learning (SPEC §12B / R48): shop-template adoption — anonymized,
-- opt-out-gated, k-anonymous cross-account view of how each shop template fares
-- across the fleet (how many adopt it, how many stay active vs go dormant, how
-- far they mature). Informs the shared shop catalog (which templates to promote /
-- retire). Structural-only: template_key + counts, never content, never per-user.
-- Staff-read-only, NO automated consumer (insight, like capability_task_performance).
--
-- Privacy: opt-out via model_contribution_enabled; k-anonymity (>=5 distinct
-- contributing accounts); security_invoker view, service_role-only read RPC.

create or replace view public.shop_template_performance with (security_invoker = true) as
  select
    s.template_key,
    count(distinct n.id) as nibbins,
    count(distinct n.account_id) as contributing_accounts,
    count(distinct n.id) filter (where n.status = 'active') as active,
    count(distinct n.id) filter (where n.status in ('sleeping', 'paused')) as dormant,
    count(distinct n.id) filter (where n.stage in ('senior', 'grad')) as senior_plus,
    count(distinct n.id) filter (where n.stage = 'grad') as graduated
  from public.nibbins n
    join public.agent_specs s on s.id = n.spec_id and s.template_key is not null
    join public.accounts acc on acc.id = n.account_id and acc.model_contribution_enabled
  group by s.template_key
  having count(distinct n.account_id) >= 5;

revoke all on public.shop_template_performance from public, anon, authenticated;

create or replace function public.shop_template_performance_read()
returns setof public.shop_template_performance
language sql
stable
security definer
set search_path = ''
as $$
  select * from public.shop_template_performance;
$$;

revoke execute on function public.shop_template_performance_read() from public, anon, authenticated;
grant execute on function public.shop_template_performance_read() to service_role;
