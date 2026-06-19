-- Cron reaper for orphaned plan_runs (fix/plan-run-reaper).
--
-- A crashed executor never flips its row to a terminal status, permanently
-- consuming one of the per-account 3-concurrent-run slots. This RPC finds
-- `running` rows whose `updated_at` has not advanced in `p_stale_minutes`
-- (default 15) and kills them. A genuinely-running executor bumps `updated_at`
-- on every save (plan_run_save), so 15 min >> the 60 s wall-clock cap means a
-- live run is never touched. Reason 'no_progress' is a valid PlanKillReason.

create function public.reap_stale_plan_runs(
  p_stale_minutes int default 15
)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count int;
begin
  update public.plan_runs
     set status     = 'killed',
         pending    = null,
         artifact   = jsonb_build_object(
                        'terminal', 'killed',
                        'reason',   'no_progress',
                        'reaped',   true
                      ),
         updated_at = now()
   where status     = 'running'
     and updated_at < now() - make_interval(mins => p_stale_minutes);

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke execute on function public.reap_stale_plan_runs(int) from public;
revoke execute on function public.reap_stale_plan_runs(int) from anon;
revoke execute on function public.reap_stale_plan_runs(int) from authenticated;
grant  execute on function public.reap_stale_plan_runs(int) to   service_role;
