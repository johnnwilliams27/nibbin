-- Tier-2 fleet learning Slice 2 (SPEC §12B / R48): an anonymized, opt-out-gated,
-- k-anonymous CROSS-ACCOUNT aggregate of capability performance — how each
-- capability's drafts fare across the fleet (approved-unedited / edited /
-- rejected / edit-distance). STRUCTURAL ONLY: capability id + decision counts,
-- never content, never per-user. Feeds staff insight ("which capabilities work")
-- → the shared capability-library / Composer / shop roadmap. NO automated
-- consumer yet — pure observability, exactly like model_task_performance.
--
-- Privacy controls (the load-bearing part):
--   * opt-out — only accounts with model_contribution_enabled contribute (the
--     same toggle that gates model_task_performance, #197).
--   * k-anonymity — a capability row is exposed ONLY when >= 5 DISTINCT accounts
--     contributed (HAVING count(distinct account_id) >= 5). Capability keys are
--     granular enough to otherwise narrow toward a single user; the model×task×tier
--     view didn't need this (system-level key), this one does.
--   * staff-only — security_invoker view, revoked from all product roles, read via
--     a security-definer RPC granted to service_role (the admin page asserts staff).

create or replace view public.capability_task_performance with (security_invoker = true) as
  select
    s.tool as capability,
    count(*) as decided_calls,
    count(*) filter (where a.decision = 'approved' and a.edit_distance = 0) as approved_unedited,
    count(*) filter (where a.decision = 'edited') as edited,
    count(*) filter (where a.decision = 'rejected') as rejected,
    avg(a.edit_distance) as avg_edit_distance,
    count(distinct s.account_id) as contributing_accounts
  from public.run_steps s
    join public.approvals a on a.run_id = s.run_id
    join public.accounts acc on acc.id = s.account_id and acc.model_contribution_enabled
  where s.kind = 'draft'
    and s.tool is not null
    and a.decided_at > (now() - interval '30 days')
  group by s.tool
  having count(distinct s.account_id) >= 5;

revoke all on public.capability_task_performance from public, anon, authenticated;

-- Staff/service-role read (the admin scoreboard asserts staff identity first).
create or replace function public.capability_task_performance_read()
returns setof public.capability_task_performance
language sql
stable
security definer
set search_path = ''
as $$
  select * from public.capability_task_performance;
$$;

revoke execute on function public.capability_task_performance_read() from public, anon, authenticated;
grant execute on function public.capability_task_performance_read() to service_role;
