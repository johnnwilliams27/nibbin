-- Tier-2 opt-out gap fix: make accounts.model_contribution_enabled actually
-- gate the cross-account aggregate it promises to. The Data & Privacy "Model
-- improvement" toggle (model_contribution_enabled, opt-out / default-on) was a
-- no-op — model_task_performance aggregated EVERY account's model_calls,
-- including accounts that had opted out, contradicting the UI copy
-- ("Nibbin learns from anonymized, aggregate signals … when this is on").
--
-- Fix: both CTEs join accounts and require model_contribution_enabled. An
-- opted-out account's calls (and account-less system calls) no longer flow into
-- the aggregate that feeds the reinforcement loop. Column list/order unchanged,
-- so the model_task_performance_read RPC + pgPerformanceSource are unaffected.

create or replace view public.model_task_performance as
 with volume as (
   select mc.model, mc.task, mc.tier,
     count(*) as calls,
     count(*) filter (where mc.outcome = 'refusal') as refusals,
     count(*) filter (where mc.outcome = 'error') as errors,
     count(*) filter (where mc.degraded) as degraded_calls,
     avg(mc.cost_microusd)::bigint as avg_cost_microusd,
     sum(mc.cost_microusd) as total_cost_microusd,
     avg(mc.latency_ms)::integer as avg_latency_ms,
     max(mc.created_at) as last_call_at
   from public.model_calls mc
     join public.accounts acc on acc.id = mc.account_id and acc.model_contribution_enabled
   where mc.created_at > (now() - interval '30 days')
   group by mc.model, mc.task, mc.tier
 ), quality as (
   select r.model, r.task, r.tier,
     count(*) as decided_calls,
     count(*) filter (where a.decision = 'approved' and a.edit_distance = 0) as approved_unedited,
     count(*) filter (where a.decision = 'edited') as edited,
     count(*) filter (where a.decision = 'rejected') as rejected,
     avg(a.edit_distance) as avg_edit_distance
   from (
     select distinct mc.run_id, mc.model, mc.task, mc.tier
     from public.model_calls mc
       join public.accounts acc on acc.id = mc.account_id and acc.model_contribution_enabled
     where mc.run_id is not null and mc.created_at > (now() - interval '30 days')
   ) r
     join public.approvals a on a.run_id = r.run_id
   group by r.model, r.task, r.tier
 )
 select v.model, v.task, v.tier, v.calls,
   coalesce(q.decided_calls, 0::bigint) as decided_calls,
   coalesce(q.approved_unedited, 0::bigint) as approved_unedited,
   coalesce(q.edited, 0::bigint) as edited,
   coalesce(q.rejected, 0::bigint) as rejected,
   q.avg_edit_distance,
   v.refusals, v.errors, v.degraded_calls,
   v.avg_cost_microusd, v.total_cost_microusd, v.avg_latency_ms, v.last_call_at
 from volume v
   left join quality q on q.model = v.model and q.task = v.task and q.tier = v.tier;
