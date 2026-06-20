-- Analytics for Nibbin (staff dashboards): aggregate read RPCs for the admin
-- analytics page. These are INTERNAL OPERATIONAL metrics (running the business —
-- sign-ups, usage, agent maturity), aggregate counts only, NEVER content. Unlike
-- the fleet-contribution aggregates (capability_task_performance), these are NOT
-- opt-out-gated: they're staff operations (like any SaaS founder's signup/usage
-- view), not user contribution to shared assets. Staff-only: SECURITY DEFINER,
-- service_role-grant, read behind the admin getStaff() gate + staff_log_access.

-- Headline numbers for the dashboard cards.
create or replace function public.analytics_overview()
returns table (
  waitlist_total bigint, waitlist_confirmed bigint,
  accounts_total bigint, accounts_7d bigint, accounts_30d bigint,
  active_1d bigint, active_7d bigint, active_30d bigint,
  runs_total bigint, runs_30d bigint,
  decided_30d bigint, approved_unedited_30d bigint, edited_30d bigint, rejected_30d bigint,
  nibbins_total bigint, nibbins_egg bigint, nibbins_student bigint, nibbins_senior bigint, nibbins_grad bigint
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    (select count(*) from public.waitlist),
    (select count(*) from public.waitlist where status = 'confirmed'),
    (select count(*) from public.accounts),
    (select count(*) from public.accounts where created_at > now() - interval '7 days'),
    (select count(*) from public.accounts where created_at > now() - interval '30 days'),
    (select count(distinct account_id) from public.runs where created_at > now() - interval '1 day'),
    (select count(distinct account_id) from public.runs where created_at > now() - interval '7 days'),
    (select count(distinct account_id) from public.runs where created_at > now() - interval '30 days'),
    (select count(*) from public.runs),
    (select count(*) from public.runs where created_at > now() - interval '30 days'),
    (select count(*) from public.approvals where decided_at > now() - interval '30 days'),
    (select count(*) from public.approvals where decided_at > now() - interval '30 days' and decision = 'approved' and edit_distance = 0),
    (select count(*) from public.approvals where decided_at > now() - interval '30 days' and decision = 'edited'),
    (select count(*) from public.approvals where decided_at > now() - interval '30 days' and decision = 'rejected'),
    (select count(*) from public.nibbins),
    (select count(*) from public.nibbins where stage = 'egg'),
    (select count(*) from public.nibbins where stage = 'student'),
    (select count(*) from public.nibbins where stage = 'senior'),
    (select count(*) from public.nibbins where stage = 'grad');
$$;

revoke execute on function public.analytics_overview() from public, anon, authenticated;
grant execute on function public.analytics_overview() to service_role;

-- Daily time series for the trend chart (default last 30 days; bounded 1..365).
create or replace function public.analytics_daily(p_days integer default 30)
returns table (
  day date,
  accounts_created bigint,
  runs bigint,
  approvals bigint,
  active_accounts bigint
)
language sql
stable
security definer
set search_path = ''
as $$
  with bounded as (select least(greatest(coalesce(p_days, 30), 1), 365) as n),
  days as (
    select generate_series(
      (now() - make_interval(days => (select n from bounded)))::date,
      now()::date,
      interval '1 day'
    )::date as day
  )
  select
    d.day,
    (select count(*) from public.accounts a where a.created_at::date = d.day),
    (select count(*) from public.runs r where r.created_at::date = d.day),
    (select count(*) from public.approvals ap where ap.decided_at::date = d.day),
    (select count(distinct r.account_id) from public.runs r where r.created_at::date = d.day)
  from days d
  order by d.day;
$$;

revoke execute on function public.analytics_daily(integer) from public, anon, authenticated;
grant execute on function public.analytics_daily(integer) to service_role;
