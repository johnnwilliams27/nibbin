-- GTM link tracking: per-source attribution on waitlist signups + a click→signup
-- funnel for the staff analytics dashboard.
--
-- Clicks are recorded as ordinary product_events (name='link_click') by the
-- apps/web /r/[code] redirect route — no new PII-bearing table. Signups gain UTM
-- columns so the acquisition source survives onto the deduped waitlist row
-- (email is the PK, so the stored source is first-touch). The funnel RPC is
-- staff-only (service_role), aggregate counts only — same posture as the other
-- analytics_* RPCs (see 20260620100000_analytics_rpcs.sql).

-- 1. First-touch attribution columns on the waitlist (all nullable, backfill-free).
alter table public.waitlist
  add column if not exists utm_source text,
  add column if not exists utm_medium text,
  add column if not exists utm_campaign text,
  add column if not exists ref text;

-- 2. Funnel aggregate: clicks (product_events) vs signups (waitlist), grouped by
--    source. FULL OUTER JOIN so a source with clicks-but-no-signups (or vice
--    versa) still shows. NULL/empty source folds into '(none)'.
create or replace function public.analytics_gtm_funnel()
returns table (source text, clicks bigint, signups bigint)
language sql
stable
security definer
set search_path = ''
as $$
  with clicks as (
    select coalesce(nullif(props->>'utm_source', ''), '(none)') as source, count(*) as n
    from public.product_events
    where name = 'link_click'
    group by 1
  ),
  signups as (
    select coalesce(nullif(utm_source, ''), '(none)') as source, count(*) as n
    from public.waitlist
    group by 1
  )
  select
    coalesce(c.source, s.source) as source,
    coalesce(c.n, 0) as clicks,
    coalesce(s.n, 0) as signups
  from clicks c
  full outer join signups s on c.source = s.source
  order by clicks desc, signups desc, source;
$$;

revoke execute on function public.analytics_gtm_funnel() from public, anon, authenticated;
grant execute on function public.analytics_gtm_funnel() to service_role;
