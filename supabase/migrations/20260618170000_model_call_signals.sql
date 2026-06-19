-- Routing Reinforcement Slice A: per-function model-performance signal
-- substrate (design 2026-06-18-routing-reinforcement-sliceA-design.md).
--
-- PURE OBSERVABILITY. This migration does NOT touch routing behavior — it adds
-- three additive signal columns to model_calls, an AGGREGATE-ONLY performance
-- view joining model_calls to approvals on run_id, and a staff-gated read RPC
-- that feeds the admin scoreboard. The future reinforcement *policy* (Slice B)
-- reads this substrate; nothing here changes which model route() picks.
--
-- Conventions follow M6.5 (20260612120000_m65_budget_cogs.sql): model_calls is
-- server plumbing (no client policies); the read RPC runs as the SERVICE ROLE,
-- mirroring account_model_cogs / staff_operations — the admin app verifies
-- staff identity + RBAC before calling, and this grant is the DB-layer backstop
-- (members see credits, never raw provider economics or cross-account telemetry).

-- ── three additive signals (back-compat: existing rows get defaults) ─────────
-- outcome ledgers graceful failures that today leave NO row (a provider error /
-- refusal / rate-limit returned null silently) — so a failing model is no
-- longer invisible. degraded surfaces budget-forced T2→T1 downgrades (route()
-- already computes decision.degraded; the call sites thread it). latency_ms is
-- the model call's wall time, null when not measured (e.g. the no-key path).
alter table public.model_calls
  add column if not exists outcome text not null default 'ok'
    check (outcome in ('ok', 'refusal', 'error')),
  add column if not exists degraded boolean not null default false,
  add column if not exists latency_ms integer;

-- Covering index for the performance view's window scan + group-by (gate P3).
-- created_at leads (the 30-day range predicate), then the group key — so both
-- the volume and quality CTEs can range-scan and aggregate without a full table
-- sweep as model_calls grows. Cheap to add now (migration not yet applied).
create index if not exists model_calls_perf_idx
  on public.model_calls (created_at, model, task, tier);

-- ── aggregated performance view (plain view: always-fresh, low read volume) ──
-- AGGREGATE-ONLY (counts per model × task × tier) — derived-not-raw, NO message
-- content, NO per-user content. 30-day rolling window. Quality metrics are over
-- the subset of calls that carry a run_id with an approvals row (drafting/
-- synthesis); volume/cost/outcome/latency are over ALL calls (diagnosis/chat
-- calls have no approval and are counted only there). Raw counts only — rates
-- are derived in the read layer so the view stays a simple count substrate.
--
-- GRANULARITY (gate finding P1 — the fan-out fix): `approvals.run_id` is UNIQUE
-- (one human decision per run), but `model_calls` has MANY rows per run_id (the
-- runner emits one model_call per prompted compose step; the planner one per
-- ReAct iteration). A naive `model_calls LEFT JOIN approvals ON run_id` would
-- multiply that single approval by the number of model_calls in the run, so a
-- 3-step run that was approved once would read as 3 decided/approved calls and
-- the avg_edit_distance would become model_call-weighted instead of run-weighted
-- — a truly-50%-approved model could surface as 80%. So quality is aggregated at
-- RUN granularity in a SEPARATE CTE and LEFT JOINed back onto the volume CTE per
-- (model, task, tier). `distinct run_id` collapses the multiple compose-step
-- rows of one run to ONE unit per (model, task, tier): one decided run counts
-- once. (A multi-MODEL run legitimately attributes its single approval to each
-- distinct (model, task) that participated — that is the intended semantics; the
-- fix removes only the WITHIN-(model, task) duplication.)
create or replace view public.model_task_performance as
with volume as (
  -- Volume / cost / outcome / latency over ALL model_calls in the window. This
  -- part was already correct; it stays at model_call granularity (one row per
  -- physical call). NO approvals join here — that is what fanned the counts out.
  select
    mc.model,
    mc.task,
    mc.tier,
    count(*)                                       as calls,
    count(*) filter (where mc.outcome = 'refusal') as refusals,
    count(*) filter (where mc.outcome = 'error')   as errors,
    count(*) filter (where mc.degraded)            as degraded_calls,
    avg(mc.cost_microusd)::bigint                  as avg_cost_microusd,
    sum(mc.cost_microusd)                          as total_cost_microusd,
    avg(mc.latency_ms)::integer                    as avg_latency_ms,
    max(mc.created_at)                             as last_call_at
  from public.model_calls mc
  where mc.created_at > now() - interval '30 days'
  group by mc.model, mc.task, mc.tier
),
quality as (
  -- Quality at RUN granularity: collapse the run's many model_calls to ONE unit
  -- per (model, task, tier) via `distinct run_id` BEFORE joining the (UNIQUE)
  -- approval. One decided run → one decided_call, regardless of how many compose
  -- steps the run emitted.
  select
    r.model,
    r.task,
    r.tier,
    count(*)                                                              as decided_calls,
    count(*) filter (where a.decision = 'approved' and a.edit_distance = 0) as approved_unedited,
    count(*) filter (where a.decision = 'edited')                          as edited,
    count(*) filter (where a.decision = 'rejected')                        as rejected,
    avg(a.edit_distance)                                                   as avg_edit_distance
  from (
    select distinct mc.run_id, mc.model, mc.task, mc.tier
    from public.model_calls mc
    where mc.run_id is not null
      and mc.created_at > now() - interval '30 days'
  ) r
  join public.approvals a on a.run_id = r.run_id
  group by r.model, r.task, r.tier
)
select
  v.model,
  v.task,
  v.tier,
  v.calls,
  coalesce(q.decided_calls, 0)     as decided_calls,
  coalesce(q.approved_unedited, 0) as approved_unedited,
  coalesce(q.edited, 0)            as edited,
  coalesce(q.rejected, 0)          as rejected,
  q.avg_edit_distance              as avg_edit_distance,
  v.refusals,
  v.errors,
  v.degraded_calls,
  v.avg_cost_microusd,
  v.total_cost_microusd,
  v.avg_latency_ms,
  v.last_call_at
from volume v
left join quality q
  on q.model = v.model and q.task = v.task and q.tier = v.tier;

-- The view is internal telemetry; no client ever reads it directly.
revoke all on public.model_task_performance from public, anon, authenticated;

-- ── staff read RPC (SECURITY DEFINER, service-role only) ─────────────────────
-- Mirrors account_model_cogs / the staff_operations RPCs: the admin app reaches
-- it via the service-role client AFTER it has verified staff identity (the admin
-- server action asserts staff_users membership — see apps/admin). authenticated
-- product users and anon can never execute it, so a non-staff account user
-- cannot reach the scoreboard data. Aggregate-only — it returns the view rows
-- verbatim, which carry no message or per-user content.
create function public.model_task_performance_read()
returns setof public.model_task_performance
language sql
security definer
set search_path = ''
stable
as $$
  select * from public.model_task_performance;
$$;
revoke execute on function public.model_task_performance_read() from public, anon, authenticated;
grant execute on function public.model_task_performance_read() to service_role;
