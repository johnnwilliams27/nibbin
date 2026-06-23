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

-- 3. Atomic first-touch waitlist join. Inserts a pending row, or on conflict fills
--    only the NULL utm columns (COALESCE: existing non-null wins) so the FIRST
--    tracked link to bring an email keeps the attribution even under two concurrent
--    first-submits — no SELECT-then-write TOCTOU. status is left untouched on
--    conflict (so a confirmed row is never downgraded). Returns true iff this call
--    inserted the row (xmax = 0), so the caller emits waitlist_joined exactly once.
create or replace function public.waitlist_join(
  p_email text,
  p_utm_source text,
  p_utm_medium text,
  p_utm_campaign text,
  p_ref text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_is_new boolean;
begin
  insert into public.waitlist (email, status, source, utm_source, utm_medium, utm_campaign, ref)
  values (p_email, 'pending', 'landing', p_utm_source, p_utm_medium, p_utm_campaign, p_ref)
  on conflict (email) do update set
    utm_source = coalesce(public.waitlist.utm_source, excluded.utm_source),
    utm_medium = coalesce(public.waitlist.utm_medium, excluded.utm_medium),
    utm_campaign = coalesce(public.waitlist.utm_campaign, excluded.utm_campaign),
    ref = coalesce(public.waitlist.ref, excluded.ref)
  returning (xmax = 0) into v_is_new;
  return v_is_new;
end;
$$;

revoke execute on function public.waitlist_join(text, text, text, text, text) from public, anon, authenticated;
grant execute on function public.waitlist_join(text, text, text, text, text) to service_role;
