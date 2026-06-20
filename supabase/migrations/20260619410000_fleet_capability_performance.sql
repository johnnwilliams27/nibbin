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

-- Supports the kind='draft' scan + run_id join below (the view's hot path).
create index if not exists run_steps_draft_run_idx
  on public.run_steps (run_id) where kind = 'draft';

create or replace view public.capability_task_performance with (security_invoker = true) as
  select
    d.capability,
    count(*) as decided_calls,
    count(*) filter (where a.decision = 'approved' and a.edit_distance = 0) as approved_unedited,
    count(*) filter (where a.decision = 'edited') as edited,
    count(*) filter (where a.decision = 'rejected') as rejected,
    avg(a.edit_distance) as avg_edit_distance,
    count(distinct d.account_id) as contributing_accounts
  from (
    -- Collapse to one row per (run, capability) BEFORE joining the run's single
    -- approval. A composed run can emit several kind='draft' steps (and may even
    -- repeat a capability), but approvals.run_id is UNIQUE — so each capability
    -- is credited ONCE per run, never once per draft step. Without this, a
    -- multi-draft run inflates decided/approved/edited/rejected and skews
    -- avg_edit_distance (the exact fan-out model_task_performance fixes with its
    -- `distinct run_id` CTE). k-anon is unaffected either way (distinct accounts).
    select distinct s.run_id, s.tool as capability, s.account_id
    from public.run_steps s
    where s.kind = 'draft' and s.tool is not null
  ) d
    join public.approvals a on a.run_id = d.run_id
    join public.accounts acc on acc.id = d.account_id and acc.model_contribution_enabled
  where a.decided_at > (now() - interval '30 days')
  group by d.capability
  having count(distinct d.account_id) >= 5;

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
